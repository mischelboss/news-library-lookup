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

// --- Sources, title variants, and cross-source duplicates ------------------------------------

const KICKER_TITLE = '„Der Polarwirbel macht komische Sachen“: Droht Deutschland jetzt ein Eiswinter?';
const HEADLINE = 'Droht Deutschland jetzt ein Eiswinter?';
const FROM = (id, name, source, date = '2026-11-04') => doc(id, name, { source, date });
const SOURCES = ['tagesspiegel.de', 'Der Tagesspiegel', 'Tagesspiegel CHECKPOINT'];
const rankTsp = (docs, title = KICKER_TITLE, variants = [KICKER_TITLE, HEADLINE]) => match.rank(title, docs, { now: NOW, sources: SOURCES, variants });

test('only the given sources are accepted, compared without case, accents, or spacing', () => {
  assert.equal(rankTsp([FROM('A', HEADLINE, 'tagesspiegel.de')]).kind, 'match');
  assert.equal(rankTsp([FROM('A', HEADLINE, 'DER   TAGESSPIEGEL')]).kind, 'match');
  assert.equal(rankTsp([FROM('A', HEADLINE, 'SPIEGEL Plus')]).kind, 'search');
  assert.equal(rankTsp([FROM('A', HEADLINE, 'Tagesspiegel')]).kind, 'search', 'a similar but different source name is not accepted');
});

test('a card title with a kicker matches a Genios title with or without it', () => {
  assert.equal(rankTsp([FROM('A', HEADLINE, 'tagesspiegel.de')]).kind, 'match');
  assert.equal(rankTsp([FROM('A', KICKER_TITLE, 'tagesspiegel.de')]).kind, 'match');
  assert.equal(rankTsp([FROM('A', 'Ein ganz anderer Titel über Eiswinter', 'tagesspiegel.de')]).kind, 'search');
});

test('the variant that fits best decides how many words must match', () => {
  // The headline alone has only two meaningful words, so it must not produce a direct match on its own.
  const short = 'Kicker hier: Zwei Wörter';
  assert.equal(match.rank(short, [FROM('A', 'Zwei Wörter', 'tagesspiegel.de')], { now: NOW, sources: SOURCES, variants: [short, 'Zwei Wörter'] }).kind, 'search');
});

test('the same article in print and web is one article; the earlier-listed source wins', () => {
  const result = rankTsp([FROM('PRINT', HEADLINE, 'Der Tagesspiegel'), FROM('WEB', HEADLINE, 'tagesspiegel.de')]);
  assert.equal(result.kind, 'match');
  assert.equal(result.candidate.id, 'WEB');
});

test('records from one source with the same title stay ambiguous, even next to another source’s copy', () => {
  const result = rankTsp([FROM('W1', HEADLINE, 'tagesspiegel.de'), FROM('W2', HEADLINE, 'tagesspiegel.de'), FROM('P1', HEADLINE, 'Der Tagesspiegel')]);
  assert.equal(result.kind, 'search');
});

test('collapsing duplicates does not let a stale copy hide the current one', () => {
  const result = rankTsp([FROM('OLD_WEB', HEADLINE, 'tagesspiegel.de', '2026-09-01'), FROM('NEW_PRINT', HEADLINE, 'Der Tagesspiegel', '2026-11-04')]);
  assert.equal(result.kind, 'match');
  assert.equal(result.candidate.id, 'NEW_PRINT');
});

test('unexpected source names are reported only when nothing matched any expected source', () => {
  const none = rankTsp([FROM('A', HEADLINE, 'SPIEGEL Plus'), FROM('B', HEADLINE, 'WELT ONLINE')]);
  assert.deepEqual([...none.unexpectedSources].sort(), ['SPIEGEL Plus', 'WELT ONLINE']);
  assert.equal(rankTsp([FROM('A', HEADLINE, 'tagesspiegel.de'), FROM('B', HEADLINE, 'WELT ONLINE')]).unexpectedSources, undefined);
  assert.equal(rankTsp([]).unexpectedSources, undefined);
});

test('queryFor uses the variant with the fewest words', () => {
  assert.equal(match.queryFor([KICKER_TITLE, HEADLINE]), 'droht deutschland jetzt eiswinter');
  assert.equal(match.queryFor([TITLE]), match.query(TITLE));
});

test('invisible soft hyphens and zero-width characters are dropped, not turned into spaces', () => {
  assert.equal(match.normalize('Wohnungs­genossenschaften'), 'wohnungsgenossenschaften');
  assert.equal(match.normalize('Wohnungs​genossenschaften﻿'), 'wohnungsgenossenschaften');
  assert.deepEqual(match.tokens('Berliner Wohnungs­genossenschaften'), match.tokens('Berliner Wohnungsgenossenschaften'));
  const card = 'Traum vom Wohnen: Bei diesen Berliner Wohnungs­genossenschaften haben Sie eine Chance';
  const result = match.rank(card, [doc('A', 'Traum vom Wohnen: Bei diesen Berliner Wohnungsgenossenschaften haben Sie eine Chance', { source: 'tagesspiegel.de', date: '2026-11-04' })], { now: NOW, sources: ['tagesspiegel.de'] });
  assert.equal(result.kind, 'match');
});

test('a search result carries counts for diagnosing why nothing matched', () => {
  const none = match.rank(TITLE, [], { now: NOW });
  assert.deepEqual({ ...none.stats }, { results: 0, accepted: 0, bestScore: 0, bestExact: false });
  const wrong = match.rank(TITLE, [doc('A', TITLE, { source: 'WELT ONLINE' })], { now: NOW });
  assert.deepEqual({ ...wrong.stats }, { results: 1, accepted: 0, bestScore: 0, bestExact: false });
  const different = match.rank(TITLE, [doc('A', 'Diese Swing Districts im Überblick')], { now: NOW });
  assert.equal(different.stats.results, 1);
  assert.equal(different.stats.accepted, 1);
  assert(different.stats.bestScore > 0 && different.stats.bestScore < 0.94);
  assert.equal(different.stats.bestExact, false);
  assert.equal(match.rank(TITLE, [doc('A')], { now: NOW }).stats, undefined, 'a match has no failure stats');
});
