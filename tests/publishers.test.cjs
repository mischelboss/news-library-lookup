const test = require('node:test');
const assert = require('node:assert/strict');
const publishers = require('../extension/publishers.js');

const spiegel = publishers.byId('spiegel');
const tagesspiegel = publishers.byId('tagesspiegel');

test('the registry lists Spiegel and Tagesspiegel with complete adapters', () => {
  assert.deepEqual(publishers.all.map(p => p.id), ['spiegel', 'tagesspiegel']);
  for (const p of publishers.all) {
    assert.match(p.origin, /^https:\/\/[a-z.]+$/);
    assert(p.listingPaths.length > 0 && p.listingPaths.every(listing => listing.startsWith('/')));
    assert(p.sources.length > 0);
    assert.equal(typeof p.inspect, 'function');
    assert.equal(typeof p.titleVariants, 'function');
    assert.equal(typeof p.cards, 'string');
    assert(p.label.length > 0);
  }
  assert.equal(publishers.byId('nope'), null);
  assert.equal(publishers.byId(undefined), null);
});

test('Genios sources are set per publisher, in priority order', () => {
  assert.deepEqual([...spiegel.sources], ['SPIEGEL Plus']);
  assert.deepEqual([...tagesspiegel.sources], ['tagesspiegel.de', 'Der Tagesspiegel', 'Tagesspiegel CHECKPOINT']);
});

test('forUrl returns a publisher only for its exact origin and a listed path', () => {
  const accepted = [['https://www.spiegel.de/', spiegel], ['https://www.spiegel.de/index.html', spiegel], ['https://www.spiegel.de/?x=1#y', spiegel], ['https://www.tagesspiegel.de/', tagesspiegel]];
  for (const [href, expected] of accepted) assert.equal(publishers.forUrl(href), expected, href);
  const rejected = [
    'https://www.spiegel.de/politik/', 'https://www.spiegel.de/politik/ausland/x-a-1234.html',
    'https://www.tagesspiegel.de/politik/', 'https://www.tagesspiegel.de/index.html',
    'http://www.spiegel.de/', 'http://www.tagesspiegel.de/',
    'https://spiegel.de/', 'https://tagesspiegel.de/', 'https://m.spiegel.de/',
    'https://www.spiegel.de.evil.test/', 'https://evil.test/www.spiegel.de/', 'https://www.spiegel.de@evil.test/',
    'https://example.org/', 'not a url', '', undefined, null,
  ];
  for (const href of rejected) assert.equal(publishers.forUrl(href), null, String(href));
});

test('Spiegel titles are used as they are; Tagesspiegel offers the form without the kicker', () => {
  assert.deepEqual([...spiegel.titleVariants('Warum die Wahl alles verändert: ein Blick')], ['Warum die Wahl alles verändert: ein Blick']);
  assert.deepEqual([...tagesspiegel.titleVariants('Kicker hier: Droht uns jetzt ein Eiswinter?')], ['Kicker hier: Droht uns jetzt ein Eiswinter?', 'Droht uns jetzt ein Eiswinter?']);
  assert.deepEqual([...tagesspiegel.titleVariants('Droht uns jetzt ein Eiswinter?')], ['Droht uns jetzt ein Eiswinter?'], 'no kicker, nothing to split');
  assert.deepEqual([...tagesspiegel.titleVariants('Kicker: zu kurz')], ['Kicker: zu kurz'], 'a remainder of fewer than three words is not a headline');
  assert.deepEqual([...tagesspiegel.titleVariants('A: B: Das ist ein langer Satz')], ['A: B: Das ist ein langer Satz'], 'a colon too early is not a kicker');
});
