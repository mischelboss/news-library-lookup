const test = require('node:test');
const assert = require('node:assert/strict');
const { match, NOW, TITLE, doc } = require('./support/harness.cjs');

const rank = (docs, title = TITLE) => match.rank(title, docs, { now: NOW });

test('a single exact SPIEGEL Plus title is a direct match', () => {
  assert.equal(rank([doc('SPPL__a')]).kind, 'match');
});

test('two equal candidates are ambiguous and stay manual searches', () => {
  assert.equal(rank([doc('SPPL__a'), doc('SPPL__b')]).kind, 'search');
});

test('short or generic titles never get a direct badge', () => {
  assert.equal(rank([doc('SPPL__a', 'Die neue Welt')], 'Die neue Welt').kind, 'search');
});

test('other sources, unsafe IDs, and unrelated titles are ignored', () => {
  assert.equal(rank([doc('OTHER__a', TITLE, { source: 'WELT ONLINE' })]).kind, 'search');
  assert.equal(rank([doc('../unsafe')]).kind, 'search');
  assert.equal(rank([doc('SPPL__a', 'So gelingt der Urlaub an der Ostsee')]).kind, 'search');
});

test('normalization folds case, accents, punctuation, and ß; the query is clean', () => {
  assert.equal(match.normalize('»Äpfel & Straße!«'), 'apfel strasse');
  assert.equal(match.query(TITLE).includes('TITEL:'), false);
});

test('parseDate reads ISO, German, and compact dates and rejects nonsense', () => {
  const expected = Date.UTC(2026, 10, 3);
  for (const value of ['2026-11-03', '2026-11-03T08:15:00', '03.11.2026', '20261103', ' 2026-11-03 ']) assert.equal(match.parseDate(value), expected, value);
  for (const value of ['', undefined, 'gestern', '2026-13-01', '2026-02-30', '31.02.2026', '3.11.2026']) assert.equal(match.parseDate(value), null, String(value));
});

test('normal window: recent and slightly future dates match directly, future ones do not', () => {
  for (const date of ['2026-11-05', '2026-10-29', '2026-11-06']) {
    const result = rank([doc('SPPL__a', TITLE, { date })]);
    assert.equal(result.kind, 'match', date);
    assert.equal(result.extended, undefined, `${date} is inside the normal window`);
  }
  assert.equal(rank([doc('SPPL__a', TITLE, { date: '2026-11-08' })]).kind, 'search', 'future dates are not trusted');
});

test('extended window: an older exact title is found by a second look at the same results', () => {
  for (const date of ['2026-10-28', '2026-06-01', '2025-11-06']) {
    const result = rank([doc('SPPL__old', TITLE, { date })]);
    assert.equal(result.kind, 'match', date);
    assert.equal(result.extended, true, date);
    assert.equal(result.candidate.id, 'SPPL__old');
  }
  assert.equal(rank([doc('SPPL__old', TITLE, { date: '2025-11-05' })]).kind, 'match', 'exactly 365 days is still inside');
  assert.equal(rank([doc('SPPL__old', TITLE, { date: '2025-11-04' })]).kind, 'search', '366 days is outside the extended window');
});

test('extended window trusts only exact titles, never loose matches', () => {
  const loose = rank([doc('SPPL__old', `${TITLE} und der`, { date: '2026-03-01' })]);
  assert.equal(loose.kind, 'search');
  assert.equal(loose.reason, 'stale');
  assert.equal(rank([doc('SPPL__new', `${TITLE} und der`, { date: '2026-11-04' })]).kind, 'match', 'the same loose match is fine when fresh');
});

test('extended window keeps ties ambiguous', () => {
  const result = rank([doc('SPPL__a', TITLE, { date: '2026-03-01' }), doc('SPPL__b', TITLE, { date: '2026-02-01' })]);
  assert.equal(result.kind, 'search');
});

test('an old exact title still beats weak fresh candidates', () => {
  const result = rank([doc('SPPL__old', TITLE, { date: '2026-03-01' }), doc('SPPL__other', 'Diese Swing Districts im Überblick', { date: '2026-11-04' })]);
  assert.equal(result.kind, 'match');
  assert.equal(result.candidate.id, 'SPPL__old');
});

test('a stale or undated exact match is withheld with a reason', () => {
  const stale = rank([doc('SPPL__a', TITLE, { date: '2024-09-01' })]);
  assert.equal(stale.kind, 'search');
  assert.equal(stale.reason, 'stale');
  const undated = rank([doc('SPPL__a', TITLE, { date: '' })]);
  assert.equal(undated.kind, 'search');
  assert.equal(undated.reason, 'undated');
  assert.equal(rank([doc('SPPL__a', 'So gelingt der Urlaub an der Ostsee')]).reason, undefined);
});

test('an old edition of a recurring title neither wins nor blocks the current one', () => {
  const result = rank([doc('SPPL__old', TITLE, { date: '2026-09-01' }), doc('SPPL__new', TITLE, { date: '2026-11-05' })]);
  assert.equal(result.kind, 'match');
  assert.equal(result.candidate.id, 'SPPL__new');
});

test('two editions inside the window stay ambiguous', () => {
  const result = rank([doc('SPPL__a', TITLE, { date: '2026-11-05' }), doc('SPPL__b', TITLE, { date: '2026-11-01' })]);
  assert.equal(result.kind, 'search');
});
