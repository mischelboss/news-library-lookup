const test = require('node:test');
const assert = require('node:assert/strict');
const { TITLE, doc, createBackground } = require('./support/harness.cjs');

const OTHER = 'Eine andere lange Schlagzeile für diesen Test';

test('equivalent concurrent lookups share one request, then hit the cache', async () => {
  const bg = createBackground();
  const [a, b] = await Promise.all([bg.lookup(TITLE), bg.lookup(TITLE)]);
  assert.equal(a.kind, 'match');
  assert.equal(b.kind, 'match');
  assert.equal(bg.state.calls.length, 1);
  assert.equal((await bg.lookup(TITLE)).cached, true);
  assert.equal(bg.state.calls.length, 1);
  assert(bg.state.saved.length > 0);
});

test('a match links to its Genios document and API requests use the JSON endpoint', async () => {
  const bg = createBackground();
  const result = await bg.lookup(TITLE);
  assert.equal(result.url, 'https://bib-voebb.genios.de/document/SPPL__a');
  const api = bg.state.calls[0];
  assert.equal(api.pathname, '/api/searchResult/Alle');
  assert.equal(api.searchParams.get('source'), 'SPIEGEL Plus');
  assert.equal(api.searchParams.get('size'), '10');
});

test('the manual search link uses the website route with the same parameters', async () => {
  const bg = createBackground({ documents: [] });
  const result = await bg.lookup(TITLE);
  assert.equal(result.kind, 'search');
  const link = new URL(result.url);
  assert.equal(link.origin, 'https://bib-voebb.genios.de');
  assert.equal(link.pathname, '/searchResult/Alle');
  const api = bg.state.calls[0];
  for (const key of ['requestText', 'source', 'size', 'sort', 'order', 'resultListType']) {
    assert.equal(link.searchParams.get(key), api.searchParams.get(key), key);
  }
});

test('lookups are accepted only from a publisher’s listing page, top frame, with a matching publisher id', async () => {
  const bg = createBackground();
  const { listener, sender, senders } = bg;
  const message = { type: 'lookup', publisher: 'spiegel', title: TITLE };
  // Positive control: the same message from the real homepage is accepted, so the rejections below are due to the sender.
  assert.notEqual(listener(message, sender), undefined);
  await bg.until(() => bg.state.calls.length === 1);
  const before = bg.state.calls.length;
  const rejected = [
    [message, { ...sender, url: 'https://evil.test/' }],
    [message, { ...sender, url: 'https://www.spiegel.de/politik/article' }],
    [message, { ...sender, url: 'https://www.spiegel.de.evil.test/' }],
    [message, { ...sender, url: 'http://www.spiegel.de/' }],
    [message, { ...sender, frameId: 1 }],
    [message, { ...sender, id: 'someone-else' }],
    [{ ...message, publisher: 'tagesspiegel' }, sender],
    [{ ...message, publisher: 'unknown' }, sender],
    [{ ...message, publisher: undefined }, sender],
    [{ ...message, publisher: 'spiegel' }, senders.tagesspiegel],
    [{ ...message, publisher: 'tagesspiegel' }, { ...senders.tagesspiegel, url: 'https://www.tagesspiegel.de/politik/' }],
    [{ ...message, publisher: 'tagesspiegel' }, { ...senders.tagesspiegel, url: 'https://tagesspiegel.de/' }],
    [{ ...message, publisher: 'tagesspiegel' }, { ...senders.tagesspiegel, frameId: 2 }],
    [{ ...message, title: 'kurz' }, sender],
  ];
  rejected.forEach(([msg, from], index) => assert.equal(listener(msg, from), undefined, `case ${index}`));
  assert.equal(bg.state.calls.length, before);
});

test('control messages are accepted only from the extension’s own pages', async () => {
  const bg = createBackground();
  for (const type of ['reset', 'retry', 'toggle', 'status']) {
    assert.equal(bg.listener({ type }, bg.sender), undefined, type);
    assert.equal(bg.listener({ type }, bg.senders.tagesspiegel), undefined, type);
  }
  assert.equal(bg.state.saved.length, 0);
});

test('a failure starts a one-minute cooldown that blocks further requests', async () => {
  const bg = createBackground();
  bg.state.mode = 'html';
  assert.equal((await bg.lookup(OTHER)).kind, 'unavailable');
  const before = bg.state.calls.length;
  assert.equal((await bg.lookup('Noch eine längere Schlagzeile für diesen Test')).kind, 'unavailable');
  assert.equal(bg.state.calls.length, before);
  bg.advance(61000);
  bg.state.mode = 'ok';
  assert.equal((await bg.lookup('Wieder eine andere Schlagzeile für diesen Test')).kind, 'search');
  assert.equal(bg.state.calls.length, before + 1);
});

const FAILURES = [
  ['network', 'network', 'could not be reached'],
  ['status', 'HTTP 503', 'error'],
  ['html', 'content-type', 'expired'],
  ['badjson', 'json', 'unreadable'],
  ['shape', 'shape', 'unexpected response format'],
  ['hang', 'timeout', 'in time'],
];
for (const [mode, label, hint] of FAILURES) {
  test(`failure category “${label}” is reported and logged without sensitive data`, async () => {
    const bg = createBackground();
    bg.state.mode = mode;
    const result = await bg.lookup(TITLE);
    assert.equal(result.kind, 'unavailable');
    assert(result.message.includes(`(${label})`), result.message);
    assert(result.message.includes(hint), result.message);
    assert.equal((await bg.own({ type: 'status' })).status, result.message);
    const warnings = bg.state.logs.filter(entry => entry.level === 'warn');
    assert.equal(warnings.length, 1);
    assert.equal(warnings[0].text, `[spiegel-voebb] spiegel search failed: ${label}`);
    const everything = bg.state.logs.map(entry => entry.text).join('\n');
    assert(!/genios|swing|districts|cookie|token/i.test(everything), everything);
  });
}

test('an unexpected exception is classed as internal', async () => {
  const bg = createBackground({ documents: [{ get documentId() { throw new Error('boom'); } }] });
  const result = await bg.lookup(TITLE);
  assert.equal(result.kind, 'unavailable');
  assert(result.message.includes('(internal)'));
});

test('retry ends the cooldown and signals open pages through storage', async () => {
  const bg = createBackground();
  bg.state.mode = 'network';
  await bg.lookup(OTHER);
  bg.state.mode = 'ok';
  const before = bg.state.calls.length;
  assert.equal((await bg.lookup('Noch eine längere Schlagzeile für diesen Test')).kind, 'unavailable');
  assert.equal(bg.state.calls.length, before, 'still cooling down');
  assert.deepEqual({ ...await bg.own({ type: 'retry' }) }, { ok: true });
  assert.equal(typeof bg.state.saved.at(-1).retryToken, 'number');
  assert.equal((await bg.lookup('Noch eine längere Schlagzeile für diesen Test')).kind, 'search');
  assert.equal(bg.state.calls.length, before + 1);
});

test('reset clears the cache and the cooldown', async () => {
  const bg = createBackground();
  await bg.lookup(TITLE);
  bg.state.mode = 'network';
  await bg.lookup(OTHER);
  await bg.own({ type: 'reset' });
  assert.deepEqual({ ...bg.state.saved.at(-1).cache }, {});
  bg.state.mode = 'ok';
  const before = bg.state.calls.length;
  assert.equal((await bg.lookup(TITLE)).cached, undefined);
  assert.equal(bg.state.calls.length, before + 1);
});

test('a request that finishes after a reset is not written to the cache', async () => {
  const bg = createBackground();
  let release;
  bg.state.gate = new Promise(resolve => { release = resolve; });
  const pending = bg.lookup(TITLE);
  await bg.until(() => bg.state.calls.length === 1);
  await bg.own({ type: 'reset' });
  const savesAfterReset = bg.state.saved.length;
  release();
  assert.equal((await pending).kind, 'match', 'the caller still gets its answer');
  assert.equal(bg.state.saved.length, savesAfterReset, 'but nothing is cached');
  assert.deepEqual({ ...bg.state.saved.at(-1).cache }, {});
});

test('a missing Genios permission is reported without a request', async () => {
  const bg = createBackground();
  bg.state.permission = false;
  const result = await bg.lookup(TITLE);
  assert.equal(result.kind, 'unavailable');
  assert(result.message.includes('Allow this extension'));
  assert.equal(bg.state.calls.length, 0);
});

test('pausing disables lookups and persists the setting', async () => {
  const bg = createBackground();
  assert.deepEqual({ ...await bg.own({ type: 'toggle' }) }, { enabled: false });
  assert.equal((await bg.lookup(TITLE)).kind, 'disabled');
  assert.equal(bg.state.calls.length, 0);
  assert.equal(bg.state.saved.at(-1).enabled, false);
});

test('the cache keeps at most 400 entries', async () => {
  const bg = createBackground({ documents: [] });
  const titles = Array.from({ length: 405 }, (_, i) => `Schlagzeile Nummer ${i} über etwas Längeres`);
  await Promise.all(titles.map(title => bg.lookup(title)));
  assert.equal(bg.state.calls.length, 405);
  assert.equal(Object.keys(bg.state.saved.at(-1).cache).length, 400);
});

test('cache entries expire: uncertain results after 20 minutes, matches after 6 hours', async () => {
  const bg = createBackground();
  const uncertain = 'Eine völlig andere Überschrift ohne Treffer hier';
  const lookups = () => bg.state.calls.length;
  await bg.lookup(TITLE);
  await bg.lookup(uncertain);
  assert.equal(lookups(), 2);
  assert.equal((await bg.lookup(uncertain)).cached, true);
  assert.equal(lookups(), 2);
  bg.advance(21 * 60000);
  assert.equal((await bg.lookup(uncertain)).cached, undefined, 'uncertain result expired');
  assert.equal(lookups(), 3);
  assert.equal((await bg.lookup(TITLE)).cached, true, 'match still cached');
  bg.advance(6 * 3600000);
  assert.equal((await bg.lookup(TITLE)).cached, undefined, 'match expired');
  assert.equal(lookups(), 4);
});

test('the status counts only unexpired cache entries', async () => {
  const bg = createBackground();
  await bg.lookup(TITLE);
  assert.equal((await bg.own({ type: 'status' })).cached, 1);
  bg.advance(7 * 3600000);
  assert.equal((await bg.own({ type: 'status' })).cached, 0);
});

test('an exact match older than the extended window is not linked directly and says why', async () => {
  const bg = createBackground({ documents: [doc('SPPL__old', TITLE, { date: '2024-09-01' })] });
  const result = await bg.lookup(TITLE);
  assert.equal(result.kind, 'search');
  assert.equal(result.reason, 'stale');
  assert(result.message.includes('more than 365 days old'));
  assert.equal(new URL(result.url).pathname, '/searchResult/Alle');
  assert(bg.state.logs.some(entry => entry.text.includes('withheld: stale')));
});

test('an undated exact match is not linked directly', async () => {
  const bg = createBackground({ documents: [doc('SPPL__a', TITLE, { date: '' })] });
  const result = await bg.lookup(TITLE);
  assert.equal(result.kind, 'search');
  assert.equal(result.reason, 'undated');
});

test('the current edition wins over an old edition with the same title', async () => {
  const bg = createBackground({ documents: [doc('SPPL__old', TITLE, { date: '2026-09-01' }), doc('SPPL__new', TITLE, { date: '2026-11-05' })] });
  const result = await bg.lookup(TITLE);
  assert.equal(result.kind, 'match');
  assert.equal(result.url, 'https://bib-voebb.genios.de/document/SPPL__new');
});

test('an older exact match is found by re-ranking the same response, with no second request', async () => {
  const bg = createBackground({ documents: [doc('SPPL__bestseller', TITLE, { date: '2026-06-01' })] });
  const result = await bg.lookup(TITLE);
  assert.equal(result.kind, 'match');
  assert.equal(result.extended, true);
  assert.equal(result.url, 'https://bib-voebb.genios.de/document/SPPL__bestseller');
  assert.equal(bg.state.calls.length, 1, 'the wider window needs no extra Genios request');
  assert(!bg.state.calls[0].searchParams.has('date'), 'the request itself has no date constraint');
  assert(bg.state.logs.some(entry => entry.text.includes('older article')));
  const cached = await bg.lookup(TITLE);
  assert.equal(cached.cached, true);
  assert.equal(cached.extended, true, 'the older-article hint survives the cache');
});

test('a normal-window match is not flagged as older', async () => {
  const bg = createBackground();
  const result = await bg.lookup(TITLE);
  assert.equal(result.kind, 'match');
  assert.equal(result.extended, undefined);
});

// --- Publishers: Tagesspiegel and the registry ---------------------------------------------------

const TSP_KICKER = '„Der Polarwirbel macht komische Sachen“';
const TSP_HEADLINE = 'Droht Deutschland jetzt ein Eiswinter?';
const TSP_TITLE = `${TSP_KICKER}: ${TSP_HEADLINE}`;
const tsp = (id, name, source = 'tagesspiegel.de', date = '2026-11-04') => doc(id, name, { source, date });

test('each publisher asks Genios only for its own sources, and the query uses the shortest title form', async () => {
  const bg = createBackground({ documents: [] });
  await bg.lookup(TSP_TITLE, 'tagesspiegel');
  await bg.lookup(OTHER, 'spiegel');
  const [tspCall, spiegelCall] = bg.state.calls;
  assert.deepEqual(tspCall.searchParams.getAll('source'), ['tagesspiegel.de', 'Der Tagesspiegel', 'Tagesspiegel CHECKPOINT']);
  assert.deepEqual(spiegelCall.searchParams.getAll('source'), ['SPIEGEL Plus']);
  assert.equal(tspCall.searchParams.get('requestText'), 'droht deutschland jetzt eiswinter', 'headline words only, so both title forms are found');
  assert.equal(tspCall.pathname, '/api/searchResult/Alle');
});

test('the Tagesspiegel manual search link carries all its sources', async () => {
  const bg = createBackground({ documents: [] });
  const result = await bg.lookup(TSP_TITLE, 'tagesspiegel');
  const link = new URL(result.url);
  assert.equal(link.pathname, '/searchResult/Alle');
  assert.deepEqual(link.searchParams.getAll('source'), ['tagesspiegel.de', 'Der Tagesspiegel', 'Tagesspiegel CHECKPOINT']);
});

test('a Tagesspiegel article matches whether Genios stores the title with or without the kicker', async () => {
  for (const stored of [TSP_HEADLINE, TSP_TITLE]) {
    const bg = createBackground({ documents: [tsp('TSP__a', stored)] });
    const result = await bg.lookup(TSP_TITLE, 'tagesspiegel');
    assert.equal(result.kind, 'match', stored);
    assert.equal(result.url, 'https://bib-voebb.genios.de/document/TSP__a');
    assert(result.message.includes('Tagesspiegel'));
  }
});

test('print and web copies of one article count as one, preferring the earlier-listed source', async () => {
  const bg = createBackground({ documents: [tsp('TSP__print', TSP_HEADLINE, 'Der Tagesspiegel'), tsp('TSP__web', TSP_HEADLINE, 'tagesspiegel.de')] });
  const result = await bg.lookup(TSP_TITLE, 'tagesspiegel');
  assert.equal(result.kind, 'match');
  assert.equal(result.url, 'https://bib-voebb.genios.de/document/TSP__web');
});

test('two records from the same source stay ambiguous', async () => {
  const bg = createBackground({ documents: [tsp('TSP__a', TSP_HEADLINE), tsp('TSP__b', TSP_HEADLINE)] });
  assert.equal((await bg.lookup(TSP_TITLE, 'tagesspiegel')).kind, 'search');
});

test('source names are compared without regard to case or spacing', async () => {
  const bg = createBackground({ documents: [tsp('TSP__a', TSP_HEADLINE, 'DER  Tagesspiegel')] });
  assert.equal((await bg.lookup(TSP_TITLE, 'tagesspiegel')).kind, 'match');
});

test('a publisher never accepts another publisher’s sources, and unexpected source names are logged', async () => {
  const spiegelDoc = createBackground({ documents: [tsp('TSP__a', TITLE, 'tagesspiegel.de')] });
  assert.equal((await spiegelDoc.lookup(TITLE, 'spiegel')).kind, 'search');
  const tspDoc = createBackground({ documents: [doc('SPPL__a', TSP_HEADLINE)] });
  assert.equal((await tspDoc.lookup(TSP_TITLE, 'tagesspiegel')).kind, 'search');
  const note = tspDoc.state.logs.find(entry => entry.text.includes('unexpected sources'));
  assert(note, 'names the sources Genios actually returned');
  assert(note.text.includes('SPIEGEL Plus'));
  assert(!note.text.includes('Eiswinter'), 'no article text in the log');
});

test('a message cannot choose sources, hosts, or paths', async () => {
  const bg = createBackground({ documents: [] });
  await bg.listener({ type: 'lookup', publisher: 'spiegel', title: TITLE, sources: ['tagesspiegel.de'], source: 'tagesspiegel.de', url: 'https://evil.test/', origin: 'https://evil.test', path: '/api/other' }, bg.sender);
  assert.equal(bg.state.calls.length, 1);
  const call = bg.state.calls[0];
  assert.equal(call.origin, 'https://bib-voebb.genios.de');
  assert.equal(call.pathname, '/api/searchResult/Alle');
  assert.deepEqual(call.searchParams.getAll('source'), ['SPIEGEL Plus']);
});

test('the cache is kept per publisher', async () => {
  const bg = createBackground({ documents: [] });
  await bg.lookup(TITLE, 'spiegel');
  await bg.lookup(TITLE, 'tagesspiegel');
  assert.equal(bg.state.calls.length, 2, 'the same headline on another site is a different lookup');
  assert.equal((await bg.lookup(TITLE, 'spiegel')).cached, true);
  assert.equal((await bg.lookup(TITLE, 'tagesspiegel')).cached, true);
  assert.equal(bg.state.calls.length, 2);
});

test('a failure for one publisher pauses only that publisher', async () => {
  const bg = createBackground();
  bg.state.mode = 'status';
  assert.equal((await bg.lookup(TSP_TITLE, 'tagesspiegel')).kind, 'unavailable');
  bg.state.mode = 'ok';
  const before = bg.state.calls.length;
  assert.equal((await bg.lookup('Noch eine Überschrift von Tagesspiegel hier', 'tagesspiegel')).kind, 'unavailable', 'still cooling down');
  assert.equal(bg.state.calls.length, before);
  assert.equal((await bg.lookup(TITLE, 'spiegel')).kind, 'match', 'Spiegel is unaffected');
  assert.equal(bg.state.calls.length, before + 1);
  await bg.own({ type: 'retry' });
  assert.equal((await bg.lookup('Noch eine Überschrift von Tagesspiegel hier', 'tagesspiegel')).kind, 'search', 'retry ends every cooldown');
});

test('every no-match result logs counts and a score, never a title', async () => {
  const cases = [
    ['nothing returned', [], 'results 0, from expected sources 0, best score 0'],
    ['only other sources', [doc('X', TSP_HEADLINE, { source: 'WELT ONLINE' })], 'results 1, from expected sources 0, best score 0'],
    ['a different title', [tsp('T1', 'Etwas ganz anderes über Wohnungen')], 'results 1, from expected sources 1, best score '],
  ];
  for (const [name, documents, expected] of cases) {
    const bg = createBackground({ documents });
    assert.equal((await bg.lookup(TSP_TITLE, 'tagesspiegel')).kind, 'search', name);
    const line = bg.state.logs.find(entry => entry.text.includes('no direct match'));
    assert(line, name);
    assert(line.text.startsWith('[spiegel-voebb] tagesspiegel: no direct match ('), line.text);
    assert(line.text.includes(expected), `${name}: ${line.text}`);
    assert(!/Eiswinter|Polarwirbel|Wohnungen|droht/i.test(line.text), 'no article text in the log');
  }
  const match = createBackground({ documents: [tsp('TSP__a', TSP_HEADLINE)] });
  await match.lookup(TSP_TITLE, 'tagesspiegel');
  assert(!match.state.logs.some(entry => entry.text.includes('no direct match')), 'a match logs no failure line');
});
