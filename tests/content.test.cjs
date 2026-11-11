const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { FakeDocument, shadowChildren } = require('./support/fake-dom.cjs');

const read = file => fs.readFileSync(path.resolve(__dirname, '../extension', file), 'utf8');
const publishersSource = read('publishers.js');
const contentSource = read('content.js');
const flush = async () => { for (let i = 0; i < 6; i++) await new Promise(resolve => setImmediate(resolve)); };
const GENIOS = 'https://bib-voebb.genios.de';
const SITES = { spiegel: 'https://www.spiegel.de', tagesspiegel: 'https://www.tagesspiegel.de' };

// Hand-written card markup shaped like what each site serves, not copied from any page.
function cards(doc) {
  // Spiegel: the paid "+" flag sits inside the headline link.
  const flag = () => doc.h('span', { 'data-contains-flags': 'plus-paid', 'data-flag-domain': 'spon' },
    doc.h('span', { 'data-flag-name': 'plus-paid' }, doc.h('svg', { width: '16', height: '16' })));
  // Tagesspiegel: a small icon, hidden text "Tagesspiegel Plus", then "kicker: headline" in one h2.
  const tspLink = (slug, id, ...inner) => doc.h('a', { href: `/wissen/${slug}-${id}.html` }, doc.h('div', {}, ...inner));
  const tspHeading = (kicker, headline, level = 'h2') => doc.h(level, {}, doc.h('span', {}, kicker), doc.h('span', { class: 'visually-hidden' }, ':'), ' ', doc.h('span', {}, headline));
  return {
    paid: (title, slug = 'beispiel') => doc.h('article', { 'data-target-teaser': '', 'aria-label': title },
      doc.h('h2', {}, doc.h('a', { href: `/politik/ausland/${slug}-a-1234abcd-5678-90ef.html` }, flag(), doc.h('span', {}, title)))),
    free: title => doc.h('article', { 'data-target-teaser': '', 'aria-label': title },
      doc.h('h2', {}, doc.h('a', { href: '/politik/ausland/kostenlos-a-0000abcd-5678-90ef.html' }, doc.h('span', {}, title)))),
    flag,
    tsp: {
      paid: (kicker, headline, slug = 'beispiel', id = 16209808, level = 'h2') => doc.h('article', { 'data-bi-hook': 'teaser' },
        tspLink(slug, id, doc.h('svg', {}), ' ', doc.h('span', { class: 'visually-hidden' }, ' Tagesspiegel Plus '), ' ', tspHeading(kicker, headline, level))),
      free: (kicker, headline) => doc.h('article', { 'data-bi-hook': 'teaser' }, tspLink('kostenlos', 16000001, tspHeading(kicker, headline))),
    },
  };
}

function setup({ site = 'spiegel', pathname = '/', href, enabled = true, build = () => [], reply } = {}) {
  const doc = new FakeDocument();
  doc.baseURI = `${SITES[site]}/`;
  const make = cards(doc);
  doc.body.append(...build(make, doc));
  const messages = [], changeListeners = [], observers = [];
  const storage = { enabled };
  // Deterministic timers: the page's debounce runs only when the test says so.
  const timers = new Map();
  let nextTimer = 1;
  const window = {}; window.top = window;
  class MutationObserver { constructor(callback) { this.callback = callback; observers.push(this); } observe() {} }
  const context = vm.createContext({
    document: doc, window, location: { pathname, href: href ?? `${SITES[site]}${pathname}` }, URL, MutationObserver,
    setTimeout: fn => { timers.set(nextTimer, fn); return nextTimer++; },
    clearTimeout: id => timers.delete(id),
    browser: {
      runtime: { sendMessage: async message => { messages.push(message); return reply ? reply(message, messages.length) : { kind: 'search', url: `${GENIOS}/searchResult/Alle?requestText=x`, message: 'No match.' }; } },
      storage: { local: { get: async key => ({ [key]: storage[key] }) }, onChanged: { addListener: fn => changeListeners.push(fn) } },
    },
  });
  vm.runInContext(publishersSource, context);
  vm.runInContext(contentSource, context);
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

// --- Spiegel ---------------------------------------------------------------------------------

test('only paid Spiegel cards get an icon and trigger a lookup', async () => {
  let paid, free;
  const page = setup({ build: make => [paid = make.paid('Warum die Wahl alles verändert'), free = make.free('Ein kostenloser Artikel')] });
  await flush();
  assert.equal(page.messages.length, 1);
  assert.deepEqual({ ...page.messages[0] }, { type: 'lookup', publisher: 'spiegel', title: 'Warum die Wahl alles verändert' });
  assert(page.badgeOf(paid));
  assert.equal(page.badgeOf(free), undefined);
});

test('the Spiegel icon sits right after the paid + icon, and adds no link to the page itself', async () => {
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

test('a Spiegel card whose link leaves spiegel.de is ignored', async () => {
  let card;
  const page = setup({ build: (make, doc) => [card = doc.h('article', { 'data-target-teaser': '' },
    doc.h('h2', {}, doc.h('a', { href: 'https://evil.test/x-a-1234.html' }, make.flag(), 'Eine ziemlich lange Überschrift')))] });
  await flush();
  assert.equal(page.messages.length, 0);
  assert.equal(page.badgeOf(card), undefined);
});

// --- Tagesspiegel ----------------------------------------------------------------------------

test('only paid Tagesspiegel cards get an icon, and the lookup sends the visible headline with the publisher id', async () => {
  let paid, free;
  const page = setup({ site: 'tagesspiegel', build: make => [paid = make.tsp.paid('„Der Polarwirbel macht komische Sachen“', 'Droht Deutschland jetzt ein Eiswinter?'), free = make.tsp.free('Kolumne', 'Ein kostenloser Beitrag zum Wochenende')] });
  await flush();
  assert.equal(page.messages.length, 1);
  assert.deepEqual({ ...page.messages[0] }, { type: 'lookup', publisher: 'tagesspiegel', title: '„Der Polarwirbel macht komische Sachen“: Droht Deutschland jetzt ein Eiswinter?' });
  assert(page.badgeOf(paid));
  assert.equal(page.badgeOf(free), undefined);
});

test('the Tagesspiegel icon sits right after the paid marker and adds no link to the page itself', async () => {
  let card;
  const page = setup({ site: 'tagesspiegel', build: make => [card = make.tsp.paid('Kicker hier', 'Eine ausreichend lange Überschrift')] });
  await flush();
  const host = page.badgeOf(card);
  const label = card.querySelectorAll('.visually-hidden').find(el => el.textContent.trim() === 'Tagesspiegel Plus');
  assert.equal(host.parent, label.parent, 'in the same line as the paid marker');
  assert.equal(label.parent.children.indexOf(host), label.parent.children.indexOf(label) + 1, 'directly after the marker label');
  assert.equal(card.querySelectorAll('a').length, 1);
});

test('a Tagesspiegel link that is not an article path or leaves the site is ignored', async () => {
  const page = setup({ site: 'tagesspiegel', build: (make, doc) => [
    doc.h('article', { 'data-bi-hook': 'teaser' }, doc.h('a', { href: 'https://evil.test/x-123.html' }, doc.h('span', { class: 'visually-hidden' }, 'Tagesspiegel Plus'), doc.h('h2', {}, 'Eine ziemlich lange Überschrift'))),
    doc.h('article', { 'data-bi-hook': 'teaser' }, doc.h('a', { href: '/politik/' }, doc.h('span', { class: 'visually-hidden' }, 'Tagesspiegel Plus'), doc.h('h2', {}, 'Eine ziemlich lange Überschrift'))),
  ] });
  await flush();
  assert.equal(page.messages.length, 0);
});

test('a paid label outside any headline link does not count', async () => {
  const page = setup({ site: 'tagesspiegel', build: (make, doc) => [doc.h('article', { 'data-bi-hook': 'teaser' }, doc.h('span', { class: 'visually-hidden' }, 'Tagesspiegel Plus'), doc.h('h2', {}, 'Eine ziemlich lange Überschrift'))] });
  await flush();
  assert.equal(page.messages.length, 0);
});

test('Tagesspiegel icons use the same states, new-tab links, and retry as Spiegel', async () => {
  let failing;
  let recovered = false;
  const page = setup({
    site: 'tagesspiegel',
    build: make => [failing = make.tsp.paid('Kicker hier', 'Diese Überschrift schlägt zuerst fehl')],
    reply: () => recovered ? { kind: 'match', url: `${GENIOS}/document/TSP__x`, matchedTitle: 'T', message: '' } : { kind: 'unavailable', url: GENIOS, message: 'down' },
  });
  await flush();
  assert.equal(stateOf(page, failing).dataset.kind, 'unavailable');
  recovered = true;
  page.fire({ retryToken: { newValue: 1 } });
  await flush();
  const link = stateOf(page, failing);
  assert.equal(link.dataset.kind, 'match');
  assert.equal(link.target, '_blank');
  assert.equal(link.rel, 'noopener noreferrer');
  assert.equal(page.messages.at(-1).publisher, 'tagesspiegel');
  assert(link.title === 'Titelübereinstimmung: T. Leserechte werden beim Öffnen geprüft.');
});

// Real Tagesspiegel pages use h2 on lead teasers but h3 on most other paid cards (46 of 55 when
// this was checked), so the heading level must not matter.
test('Tagesspiegel paid cards are found whatever the heading level', async () => {
  const cardsByLevel = {};
  const page = setup({ site: 'tagesspiegel', build: make => ['h1', 'h2', 'h3', 'h4'].map((level, i) => cardsByLevel[level] = make.tsp.paid(`Kicker ${level}`, `Die lange Überschrift Nummer ${i} hier`, `slug${i}`, 16000100 + i, level)) });
  await flush();
  assert.equal(page.messages.length, 4);
  for (const level of Object.keys(cardsByLevel)) assert(page.badgeOf(cardsByLevel[level]), level);
  assert.deepEqual(page.messages.map(m => m.title).sort(), ['Kicker h1: Die lange Überschrift Nummer 0 hier', 'Kicker h2: Die lange Überschrift Nummer 1 hier', 'Kicker h3: Die lange Überschrift Nummer 2 hier', 'Kicker h4: Die lange Überschrift Nummer 3 hier']);
});

test('invisible soft hyphens inside words are removed from the title that is sent', async () => {
  const page = setup({ site: 'tagesspiegel', build: make => [make.tsp.paid('Traum vom günstigen Wohnen', 'Bei diesen Berliner Wohnungs­genossenschaften haben Sie noch eine Chance', 'traum', 16055242, 'h3')] });
  await flush();
  assert.equal(page.messages[0].title, 'Traum vom günstigen Wohnen: Bei diesen Berliner Wohnungsgenossenschaften haben Sie noch eine Chance');
  assert(!/[­​-‍⁠﻿]/.test(page.messages[0].title));
});

test('Spiegel articles without a slug in the link are still found, placeholders and foreign links are not', async () => {
  const paid = (doc, href, title) => doc.h('article', { 'data-target-teaser': '', 'aria-label': title },
    doc.h('h3', {}, doc.h('a', { href }, doc.h('span', { 'data-contains-flags': 'plus-paid', 'data-flag-domain': 'spon' }, doc.h('span', { 'data-flag-name': 'plus-paid' })), title)));
  const page = setup({ build: (make, doc) => [
    paid(doc, 'https://www.spiegel.de/kultur/a-d09542e6-e898-489d-ae14-2dc02a43fbe4#laing', 'Ein Artikel ohne Slug im Link'),
    paid(doc, '/panorama/ein-artikel-mit-slug-a-d09542e6-e898-489d-ae14-2dc02a43fbe5', 'Ein Artikel mit Slug im Link'),
    paid(doc, '__proto_url__', 'Ein Platzhalter ohne echten Link'),
    paid(doc, 'https://www.manager-magazin.de/unternehmen/x-a-d09542e6-e898-489d-ae14-2dc02a43fbe6', 'Ein Artikel einer anderen Seite'),
    paid(doc, '/panorama/ratgeber/', 'Eine Übersichtsseite statt Artikel'),
  ] });
  await flush();
  assert.deepEqual(page.messages.map(m => m.title).sort(), ['Ein Artikel mit Slug im Link', 'Ein Artikel ohne Slug im Link']);
});

test('Spiegel cards paid under another flag domain (for example effilee) are not ours', async () => {
  const page = setup({ build: (make, doc) => [doc.h('article', { 'data-target-teaser': '', 'aria-label': 'Ein Rezept aus der Küche' },
    doc.h('h2', {}, doc.h('a', { href: '/effilee/rezept/ein-rezept-a-e96beb7a-0005-0011-0000-000010013763' }, doc.h('span', { 'data-contains-flags': 'plus-paid', 'data-flag-domain': 'effilee' }, doc.h('span', { 'data-flag-name': 'plus-paid' })), 'Ein Rezept aus der Küche')))] });
  await flush();
  assert.equal(page.messages.length, 0);
});

// --- Where the script runs -------------------------------------------------------------------

test('the script does nothing outside a publisher’s listing pages or on other sites', async () => {
  for (const options of [{ pathname: '/politik/' }, { site: 'tagesspiegel', pathname: '/politik/' }, { href: 'https://example.org/' }, { href: 'https://www.spiegel.de.evil.test/' }, { href: 'http://www.spiegel.de/' }]) {
    const page = setup({ ...options, build: make => [make.paid('Warum die Wahl alles verändert'), make.tsp.paid('Kicker hier', 'Eine ausreichend lange Überschrift')] });
    await flush();
    assert.equal(page.messages.length, 0, JSON.stringify(options));
    assert.equal(page.observers.length, 0, JSON.stringify(options));
  }
});

test('Spiegel cards are not read on tagesspiegel.de and the other way around', async () => {
  const onTsp = setup({ site: 'tagesspiegel', build: make => [make.paid('Warum die Wahl alles verändert')] });
  const onSpiegel = setup({ site: 'spiegel', build: make => [make.tsp.paid('Kicker hier', 'Eine ausreichend lange Überschrift')] });
  await flush();
  assert.equal(onTsp.messages.length, 0);
  assert.equal(onSpiegel.messages.length, 0);
});

// --- Icon states, colors, behavior (shared) --------------------------------------------------

test('while checking, a neutral grey icon shows the search is pending', async () => {
  let card;
  const page = setup({ build: make => [card = make.paid('Warum die Wahl alles verändert')], reply: () => new Promise(() => {}) });
  await flush();
  const pending = stateOf(page, card);
  assert.equal(pending.tagName, 'SPAN');
  assert.equal(pending.dataset.kind, 'pending');
  assert.equal(pending.getAttribute('role'), 'img');
  assert(pending.title.startsWith('Suche in SPIEGEL Plus:'));
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

test('retry re-checks only failed icons, without a reload', async () => {
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

test('pausing removes icons and a disabled start adds none', async () => {
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

test('icon insertions alone do not trigger another scan', async () => {
  let card;
  const page = setup({ build: make => [card = make.paid('Warum die Wahl alles verändert')] });
  await flush();
  const host = page.badgeOf(card);
  page.observers[0].callback([{ addedNodes: [host], removedNodes: [] }]);
  assert.equal(page.timers.size, 0, 'no rescan is scheduled for the extension’s own icon');
  await page.runTimers();
  assert.equal(page.messages.length, 1);
});
