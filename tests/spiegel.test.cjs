const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { FakeDocument, shadowChildren } = require('./support/fake-dom.cjs');

const source = fs.readFileSync(path.resolve(__dirname, '../extension/spiegel.js'), 'utf8');
const flush = async () => { for (let i = 0; i < 6; i++) await new Promise(resolve => setImmediate(resolve)); };
const GENIOS = 'https://bib-voebb.genios.de';

// Hand-written card markup in the shape the extension looks for; not copied from any publisher page.
function cards(doc) {
  return {
    paid: (title, slug = 'beispiel') => doc.h('article', { 'data-target-teaser': '', 'aria-label': title },
      doc.h('div', { 'data-flag-domain': 'spon' }, doc.h('span', { 'data-flag-name': 'plus-paid' })),
      doc.h('h2', {}, doc.h('a', { href: `/politik/ausland/${slug}-a-1234abcd-5678-90ef.html` }, title))),
    free: title => doc.h('article', { 'data-target-teaser': '', 'aria-label': title },
      doc.h('h2', {}, doc.h('a', { href: '/politik/ausland/kostenlos-a-0000abcd-5678-90ef.html' }, title))),
  };
}

function setup({ pathname = '/', enabled = true, build = () => [], reply } = {}) {
  const doc = new FakeDocument();
  const make = cards(doc);
  doc.body.append(...build(make, doc));
  const messages = [], changeListeners = [], observers = [];
  const storage = { enabled };
  // Deterministic timers: the page's debounce runs only when the test says so.
  const timers = new Map();
  let nextTimer = 1;
  const window = {}; window.top = window;
  class MutationObserver { constructor(callback) { this.callback = callback; observers.push(this); } observe() {} }
  const context = {
    document: doc, window, location: { pathname }, URL, MutationObserver,
    setTimeout: fn => { timers.set(nextTimer, fn); return nextTimer++; },
    clearTimeout: id => timers.delete(id),
    browser: {
      runtime: { sendMessage: async message => { messages.push(message); return reply ? reply(message, messages.length) : { kind: 'search', url: `${GENIOS}/searchResult/Alle?requestText=x`, message: 'No match.' }; } },
      storage: { local: { get: async key => ({ [key]: storage[key] }) }, onChanged: { addListener: fn => changeListeners.push(fn) } },
    },
  };
  vm.runInNewContext(source, context);
  const fire = (changes, area = 'local') => changeListeners.forEach(fn => fn(changes, area));
  const badgeOf = card => card.children.find(child => child.nodeType === 1 && child.hasAttribute('data-voebb-badge'));
  const runTimers = async () => { for (const [id, fn] of [...timers]) { timers.delete(id); fn(); } await flush(); };
  return { doc, messages, observers, timers, make, fire, badgeOf, storage, runTimers };
}

test('only paid Spiegel cards get a badge and trigger a lookup', async () => {
  let paid, free;
  const page = setup({ build: make => [paid = make.paid('Warum die Wahl alles verändert'), free = make.free('Ein kostenloser Artikel')] });
  await flush();
  assert.equal(page.messages.length, 1);
  assert.equal(page.messages[0].type, 'lookup');
  assert.equal(page.messages[0].title, 'Warum die Wahl alles verändert');
  assert(page.badgeOf(paid));
  assert.equal(page.badgeOf(free), undefined);
});

test('a card whose link leaves spiegel.de is ignored', async () => {
  let card;
  const page = setup({ build: (make, doc) => [card = doc.h('article', { 'data-target-teaser': '' },
    doc.h('div', { 'data-flag-domain': 'spon' }, doc.h('span', { 'data-flag-name': 'plus-paid' })),
    doc.h('h2', {}, doc.h('a', { href: 'https://evil.test/x-a-1234.html' }, 'Eine ziemlich lange Überschrift'))) ] });
  await flush();
  assert.equal(page.messages.length, 0);
  assert.equal(page.badgeOf(card), undefined);
});

test('a match becomes a same-tab Genios link and remote text stays text', async () => {
  let card;
  const page = setup({
    build: make => [card = make.paid('Warum die Wahl alles verändert')],
    reply: () => ({ kind: 'match', url: `${GENIOS}/document/SPPL__a`, matchedTitle: '<img src=x onerror=alert(1)>', date: '2026-11-03', message: '' }),
  });
  await flush();
  const [link] = shadowChildren(page.badgeOf(card));
  assert.equal(link.tagName, 'A');
  assert.equal(link.href, `${GENIOS}/document/SPPL__a`);
  assert.equal(link.target, '_self');
  assert.equal(link.referrerPolicy, 'no-referrer');
  assert.equal(link.textContent, 'Über VÖBB lesen ↗');
  assert(link.title.includes('<img'), 'shown as text in the tooltip');
  assert.equal(page.badgeOf(card).shadowRoot.querySelectorAll('img').length, 0, 'never parsed as markup');
});

test('a result pointing outside Genios is rejected', async () => {
  let card;
  const page = setup({
    build: make => [card = make.paid('Warum die Wahl alles verändert')],
    reply: () => ({ kind: 'match', url: 'https://evil.test/document/1', message: '' }),
  });
  await flush();
  const [label] = shadowChildren(page.badgeOf(card));
  assert.equal(label.tagName, 'SPAN');
  assert.equal(label.textContent, 'VÖBB: Prüfung nicht möglich');
});

test('retry re-checks only failed badges, without a reload', async () => {
  let failing, working;
  let recovered = false;
  const page = setup({
    build: make => [failing = make.paid('Diese Überschrift schlägt zuerst fehl', 'eins'), working = make.paid('Diese Überschrift funktioniert sofort', 'zwei')],
    reply: message => message.title.includes('schlägt') && !recovered
      ? { kind: 'unavailable', url: GENIOS, message: 'Search unavailable.' }
      : { kind: 'match', url: `${GENIOS}/document/SPPL__x`, matchedTitle: 'T', message: '' },
  });
  await flush();
  assert.equal(shadowChildren(page.badgeOf(failing))[0].dataset.kind, 'unavailable');
  assert.equal(shadowChildren(page.badgeOf(working))[0].dataset.kind, 'match');
  assert.equal(page.messages.length, 2);

  recovered = true;
  page.fire({ retryToken: { newValue: 1 } });
  await flush();
  assert.equal(shadowChildren(page.badgeOf(failing))[0].dataset.kind, 'match');
  assert.equal(page.messages.length, 3, 'the working card was not queried again');
  assert.equal(page.messages[2].title, 'Diese Überschrift schlägt zuerst fehl');
});

test('retry does nothing while checks are paused', async () => {
  let card;
  const page = setup({
    build: make => [card = make.paid('Warum die Wahl alles verändert')],
    reply: () => ({ kind: 'unavailable', url: GENIOS, message: 'down' }),
  });
  await flush();
  page.storage.enabled = false;
  page.fire({ retryToken: { newValue: 1 } });
  await flush();
  assert.equal(page.messages.length, 1);
  assert(page.badgeOf(card));
});

test('pausing removes badges and a disabled start adds none', async () => {
  let card;
  const page = setup({ build: make => [card = make.paid('Warum die Wahl alles verändert')] });
  await flush();
  assert(page.badgeOf(card));
  page.fire({ enabled: { newValue: false } });
  assert.equal(page.badgeOf(card), undefined);

  const paused = setup({ enabled: false, build: make => [make.paid('Warum die Wahl alles verändert')] });
  await flush();
  assert.equal(paused.messages.length, 0);
});

test('cards inserted later are picked up, and existing ones are not re-queried', async () => {
  let added;
  const page = setup({ build: make => [make.paid('Die erste lange Überschrift hier', 'eins')] });
  await flush();
  assert.equal(page.messages.length, 1);
  added = page.make.paid('Die zweite lange Überschrift hier', 'zwei');
  page.doc.body.append(added);
  page.observers[0].callback([{ addedNodes: [added], removedNodes: [] }]);
  assert.equal(page.timers.size, 1, 'a debounced rescan is scheduled');
  await page.runTimers();
  assert.equal(page.messages.length, 2);
  assert.equal(page.messages[1].title, 'Die zweite lange Überschrift hier');
  assert(page.badgeOf(added));
});

test('badge insertions alone do not trigger another scan', async () => {
  const page = setup({ build: make => [make.paid('Warum die Wahl alles verändert')] });
  await flush();
  const host = page.doc.body.children[0].children.find(child => child.nodeType === 1 && child.hasAttribute('data-voebb-badge'));
  page.observers[0].callback([{ addedNodes: [host], removedNodes: [] }]);
  assert.equal(page.timers.size, 0, 'no rescan is scheduled for the extension’s own badge');
  await page.runTimers();
  assert.equal(page.messages.length, 1);
});

test('the script does nothing outside the homepage', async () => {
  const page = setup({ pathname: '/politik/', build: make => [make.paid('Warum die Wahl alles verändert')] });
  await flush();
  assert.equal(page.messages.length, 0);
  assert.equal(page.observers.length, 0);
});
