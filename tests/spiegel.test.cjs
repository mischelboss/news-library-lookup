const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { FakeDocument, shadowChildren } = require('./support/fake-dom.cjs');

const source = fs.readFileSync(path.resolve(__dirname, '../extension/spiegel.js'), 'utf8');
const flush = async () => { for (let i = 0; i < 6; i++) await new Promise(resolve => setImmediate(resolve)); };
const GENIOS = 'https://bib-voebb.genios.de';

// Hand-written card markup in the shape the extension looks for, with the paid "+" flag inside the
// headline link as on the real page; not copied from any publisher page.
function cards(doc) {
  const flag = () => doc.h('span', { 'data-contains-flags': 'plus-paid', 'data-flag-domain': 'spon' },
    doc.h('span', { 'data-flag-name': 'plus-paid' }, doc.h('svg', { width: '16', height: '16' })));
  return {
    paid: (title, slug = 'beispiel') => doc.h('article', { 'data-target-teaser': '', 'aria-label': title },
      doc.h('h2', {}, doc.h('a', { href: `/politik/ausland/${slug}-a-1234abcd-5678-90ef.html` }, flag(), doc.h('span', {}, title)))),
    free: title => doc.h('article', { 'data-target-teaser': '', 'aria-label': title },
      doc.h('h2', {}, doc.h('a', { href: '/politik/ausland/kostenlos-a-0000abcd-5678-90ef.html' }, doc.h('span', {}, title)))),
    flag,
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
  const badgeOf = card => card.querySelector('[data-voebb-badge]') ?? undefined;
  const runTimers = async () => { for (const [id, fn] of [...timers]) { timers.delete(id); fn(); } await flush(); };
  return { doc, messages, observers, timers, make, fire, badgeOf, storage, runTimers };
}

const stateOf = (page, card) => shadowChildren(page.badgeOf(card))[0];
const fillOf = element => element.querySelector('circle').getAttribute('fill');
function saturation(hex) {
  const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255);
  const max = Math.max(r, g, b), min = Math.min(r, g, b), light = (max + min) / 2;
  return max === min ? 0 : (max - min) / (1 - Math.abs(2 * light - 1));
}

test('only paid Spiegel cards get an icon and trigger a lookup', async () => {
  let paid, free;
  const page = setup({ build: make => [paid = make.paid('Warum die Wahl alles verändert'), free = make.free('Ein kostenloser Artikel')] });
  await flush();
  assert.equal(page.messages.length, 1);
  assert.equal(page.messages[0].type, 'lookup');
  assert.equal(page.messages[0].title, 'Warum die Wahl alles verändert');
  assert(page.badgeOf(paid));
  assert.equal(page.badgeOf(free), undefined);
});

test('the icon sits right after the paid + icon, and adds no link to the page itself', async () => {
  let card;
  const page = setup({ build: make => [card = make.paid('Warum die Wahl alles verändert')] });
  await flush();
  const host = page.badgeOf(card);
  const wrapper = card.querySelector('[data-contains-flags]');
  assert.equal(host.parent, wrapper, 'inside the small flags wrapper, not under the article');
  const plus = wrapper.querySelector('[data-flag-name]');
  assert.equal(wrapper.children.indexOf(host), wrapper.children.indexOf(plus) + 1, 'directly after the + icon');
  assert.equal(card.querySelectorAll('a').length, 1, 'only the headline link; ours lives in a shadow root');
  assert.equal(host.tagName, 'SPAN');
});

test('a card whose link leaves spiegel.de is ignored', async () => {
  let card;
  const page = setup({ build: (make, doc) => [card = doc.h('article', { 'data-target-teaser': '' },
    doc.h('h2', {}, doc.h('a', { href: 'https://evil.test/x-a-1234.html' }, make.flag(), 'Eine ziemlich lange Überschrift')))] });
  await flush();
  assert.equal(page.messages.length, 0);
  assert.equal(page.badgeOf(card), undefined);
});

test('while checking, a neutral grey icon shows the search is pending', async () => {
  let card;
  const page = setup({ build: make => [card = make.paid('Warum die Wahl alles verändert')], reply: () => new Promise(() => {}) });
  await flush();
  const pending = stateOf(page, card);
  assert.equal(pending.tagName, 'SPAN');
  assert.equal(pending.dataset.kind, 'pending');
  assert.equal(pending.getAttribute('role'), 'img');
});

test('found: a green check icon opening the Genios record in a new tab', async () => {
  let card;
  const page = setup({
    build: make => [card = make.paid('Warum die Wahl alles verändert')],
    reply: () => ({ kind: 'match', url: `${GENIOS}/document/SPPL__a`, matchedTitle: '<img src=x onerror=alert(1)>', date: '2026-11-03', message: '' }),
  });
  await flush();
  const link = stateOf(page, card);
  assert.equal(link.tagName, 'A');
  assert.equal(link.dataset.kind, 'match');
  assert.equal(link.href, `${GENIOS}/document/SPPL__a`);
  assert.equal(link.target, '_blank');
  assert.equal(link.rel, 'noopener noreferrer');
  assert.equal(link.referrerPolicy, 'no-referrer');
  assert.equal(link.getAttribute('aria-label'), 'Über VÖBB lesen');
  assert.equal(fillOf(link), '#0b9a4d');
  assert(link.title.includes('<img'), 'shown as text in the tooltip');
  assert(!link.title.includes('Älterer Artikel'));
  assert.equal(page.badgeOf(card).shadowRoot.querySelectorAll('img').length, 0, 'never parsed as markup');
});

test('a match from the extended window warns that the article is older', async () => {
  let card;
  const page = setup({
    build: make => [card = make.paid('Warum die Wahl alles verändert')],
    reply: () => ({ kind: 'match', extended: true, url: `${GENIOS}/document/SPPL__old`, matchedTitle: 'T', date: '2026-03-01', message: '' }),
  });
  await flush();
  assert(stateOf(page, card).title.includes('Älterer Artikel'));
});

test('not found: a blue magnifier opening a Genios search in a new tab', async () => {
  let card;
  const page = setup({ build: make => [card = make.paid('Warum die Wahl alles verändert')] });
  await flush();
  const link = stateOf(page, card);
  assert.equal(link.tagName, 'A');
  assert.equal(link.dataset.kind, 'search');
  assert.equal(link.target, '_blank');
  assert.equal(link.rel, 'noopener noreferrer');
  assert.equal(link.getAttribute('aria-label'), 'In Genios suchen');
  assert.equal(fillOf(link), '#1a6fe0');
  assert.equal(link.title, 'No match.');
});

test('found and search colors are strongly saturated and clearly different', async () => {
  const found = setup({ build: make => [make.paid('Warum die Wahl alles verändert')], reply: () => ({ kind: 'match', url: `${GENIOS}/document/X`, matchedTitle: 'T', message: '' }) });
  const search = setup({ build: make => [make.paid('Warum die Wahl alles verändert')] });
  await flush();
  const green = fillOf(stateOf(found, found.doc.querySelector('article')));
  const blue = fillOf(stateOf(search, search.doc.querySelector('article')));
  assert.notEqual(green, blue);
  assert(saturation(green) >= 0.75, `green too dull: ${green}`);
  assert(saturation(blue) >= 0.75, `blue too dull: ${blue}`);
});

test('an unavailable Genios opens its sign-in page in a new tab', async () => {
  let card;
  const page = setup({
    build: make => [card = make.paid('Warum die Wahl alles verändert')],
    reply: () => ({ kind: 'unavailable', url: GENIOS, message: 'Search unavailable.' }),
  });
  await flush();
  const link = stateOf(page, card);
  assert.equal(link.dataset.kind, 'unavailable');
  assert.equal(link.target, '_blank');
  assert.equal(link.getAttribute('aria-label'), 'VÖBB anmelden / erneut prüfen');
});

test('a result pointing outside Genios is rejected', async () => {
  let card;
  const page = setup({
    build: make => [card = make.paid('Warum die Wahl alles verändert')],
    reply: () => ({ kind: 'match', url: 'https://evil.test/document/1', message: '' }),
  });
  await flush();
  const marker = stateOf(page, card);
  assert.equal(marker.tagName, 'SPAN');
  assert.equal(marker.dataset.kind, 'error');
  assert.equal(marker.getAttribute('aria-label'), 'VÖBB: Prüfung nicht möglich');
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
  assert.equal(stateOf(page, failing).dataset.kind, 'unavailable');
  assert.equal(stateOf(page, working).dataset.kind, 'match');
  assert.equal(page.messages.length, 2);

  recovered = true;
  page.fire({ retryToken: { newValue: 1 } });
  await flush();
  assert.equal(stateOf(page, failing).dataset.kind, 'match');
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
  let card;
  const page = setup({ build: make => [card = make.paid('Warum die Wahl alles verändert')] });
  await flush();
  const host = page.badgeOf(card);
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
