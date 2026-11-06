const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { FakeDocument } = require('./support/fake-dom.cjs');
const { createBackground } = require('./support/harness.cjs');

const root = path.resolve(__dirname, '../extension');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const flush = async () => { for (let i = 0; i < 6; i++) await new Promise(resolve => setImmediate(resolve)); };

test('every element id a page script looks up exists in its HTML page', () => {
  for (const [html, script] of [['popup.html', 'popup.js'], ['onboarding.html', 'onboarding.js']]) {
    const ids = new Set([...read(html).matchAll(/\bid="([^"]+)"/g)].map(match => match[1]));
    const wanted = [...read(script).matchAll(/getElementById\('([^']+)'\)/g)].map(match => match[1]);
    assert(wanted.length > 0, `${script} looks up no elements`);
    for (const id of wanted) assert(ids.has(id), `${script} uses #${id}, which ${html} does not define`);
  }
});

test('extension pages load only local scripts and styles, with no inline script', () => {
  for (const page of ['popup.html', 'onboarding.html']) {
    const html = read(page);
    assert(!/<script(?![^>]*\bsrc=)/i.test(html), `${page} has an inline script`);
    assert(!/\son[a-z]+=/i.test(html), `${page} has an inline event handler`);
    for (const [, target] of html.matchAll(/<(?:script|link)\b[^>]*\b(?:src|href)="([^"]+)"/g)) {
      assert(!/^[a-z][a-z0-9+.-]*:/i.test(target), `${page} loads a remote resource: ${target}`);
    }
  }
});

test('a fresh install opens the onboarding page once; updates and restarts do not', () => {
  const bg = createBackground();
  bg.state.installed({ reason: 'update' });
  bg.state.installed({ reason: 'browser_update' });
  assert.equal(bg.state.tabs.length, 0);
  bg.state.installed({ reason: 'install' });
  assert.deepEqual(bg.state.tabs.map(tab => tab.url), ['moz-extension://test/onboarding.html']);
});

function onboarding({ granted }) {
  const doc = new FakeDocument();
  const access = doc.h('p', { id: 'access' });
  const grant = doc.h('button', { id: 'grant' });
  doc.body.append(access, grant);
  grant.hidden = true;
  const calls = { contains: [], request: [] };
  const state = { granted };
  const context = {
    document: doc,
    browser: { permissions: {
      contains: async query => { calls.contains.push(query); return state.granted; },
      request: async query => { calls.request.push(query); state.granted = state.requestResult ?? true; return state.granted; },
    } },
  };
  vm.runInNewContext(read('onboarding.js'), context);
  return { access, grant, calls, state };
}

test('onboarding shows the Genios access state and hides the grant button when allowed', async () => {
  const page = onboarding({ granted: true });
  await flush();
  assert(page.access.textContent.includes('is allowed'));
  assert.equal(page.grant.hidden, true);
  assert.deepEqual(JSON.parse(JSON.stringify(page.calls.contains[0])), { origins: ['https://bib-voebb.genios.de/*'] });
});

test('onboarding offers to grant access, requests only the Genios origin, and updates', async () => {
  const page = onboarding({ granted: false });
  await flush();
  assert(page.access.textContent.includes('not allowed yet'));
  assert.equal(page.grant.hidden, false);
  page.grant.listeners.get('click')();
  await flush();
  assert.equal(page.calls.request.length, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(page.calls.request[0])), { origins: ['https://bib-voebb.genios.de/*'] });
  assert(page.access.textContent.includes('is allowed'));
  assert.equal(page.grant.hidden, true);
});

test('onboarding survives a declined or failing permission request', async () => {
  const page = onboarding({ granted: false });
  await flush();
  page.state.requestResult = false;
  page.grant.listeners.get('click')();
  await flush();
  assert(page.access.textContent.includes('not allowed yet'));
  assert.equal(page.grant.hidden, false);
});

test('the privacy text names what is sent and where', () => {
  const html = read('onboarding.html');
  assert(html.includes('headline'));
  assert(html.includes('Genios'));
  assert(/never reads or stores your password, cookies, or tokens/.test(html));
});
