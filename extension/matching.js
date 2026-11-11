/* Shared pure matching functions: browser background script and Node tests. */
globalThis.VoebbMatch = (() => {
  const STOP = new Set('aber als am an auch auf aus bei das dass dem den der des die ein eine einem einen einer eines er es für im in ist mit nach nicht noch oder sich sie sind so und vom von vor war was wie wir zu zum zur'.split(' '));
  const DAY = 86400000;
  // Freshness guard: a direct badge needs a candidate published within this many days of today.
  // It cannot tell apart two editions of a weekly series that fall inside the window.
  const MAX_AGE_DAYS = 7;
  // Second pass for older pieces (for example long-lived Bestseller articles): if nothing matched
  // inside the normal window, the same results are ranked again with this wider window, and then
  // only an exact title counts.
  const EXTENDED_MAX_AGE_DAYS = 365;
  const DATE_FORMATS = [
    [/^(\d{4})-(\d{2})-(\d{2})(?!\d)/, m => [m[1], m[2], m[3]]],
    [/^(\d{2})\.(\d{2})\.(\d{4})(?!\d)/, m => [m[3], m[2], m[1]]],
    [/^(\d{4})(\d{2})(\d{2})$/, m => [m[1], m[2], m[3]]],
  ];
  // Soft hyphens and zero-width characters are invisible; dropping them (not splitting on them)
  // keeps "Wohnungs\u00ADgenossenschaften" one word.
  const INVISIBLE = /[\u00AD\u200B-\u200D\u2060\uFEFF]/g;
  function normalize(value) {
    return String(value || '').replace(INVISIBLE, '').normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/ß/g, 'ss').replace(/[^\p{L}\p{N}]+/gu, ' ').trim().replace(/\s+/g, ' ');
  }
  function tokens(value) { return [...new Set(normalize(value).split(' ').filter(w => w.length > 1 && !STOP.has(w)))]; }
  function query(title) { return tokens(title).slice(0, 10).join(' '); }
  // The search query for a card that has alternative titles: the variant with the fewest words,
  // because its words appear in every other form of the title.
  function queryFor(variants) { return query([...variants].sort((a, b) => tokens(a).length - tokens(b).length)[0]); }
  // Returns the UTC midnight (ms) of a recognised date string, or null.
  function parseDate(value) {
    const text = String(value || '').trim();
    for (const [pattern, pick] of DATE_FORMATS) {
      const found = pattern.exec(text);
      if (!found) continue;
      const [year, month, day] = pick(found).map(Number);
      const time = Date.UTC(year, month - 1, day);
      const check = new Date(time);
      return check.getUTCFullYear() === year && check.getUTCMonth() === month - 1 && check.getUTCDate() === day ? time : null;
    }
    return null;
  }
  function isFresh(time, now, maxAgeDays) {
    if (time === null) return false;
    const age = Math.round((Math.floor(now / DAY) * DAY - time) / DAY);
    return age >= -1 && age <= maxAgeDays; // one day of slack for time zones
  }
  // Short or generic titles and closely tied candidates never receive a direct match.
  function decide(list) {
    const first = list[0], second = list[1];
    const strong = Boolean(first && first.wantedLength >= 3 && (!second || first.score - second.score >= 0.12) && (first.exact || (first.wantedLength >= 5 && first.score >= 0.94)));
    return strong ? first : null;
  }
  // The same article often exists in several Genios sources (for example print and web) under one
  // title. Identical normalized titles from different sources are one article: keep the source
  // listed first. Several records from the same source stay separate, so real ambiguity survives.
  function collapse(list) {
    const best = new Map();
    for (const candidate of list) {
      const key = normalize(candidate.title);
      if (!best.has(key) || candidate.sourceRank < best.get(key)) best.set(key, candidate.sourceRank);
    }
    return list.filter(candidate => candidate.sourceRank === best.get(normalize(candidate.title)));
  }
  // `options.sources`: Genios source names a candidate may come from, in priority order.
  // `options.variants`: alternative spellings of the card title (for example with and without a
  // kicker); a candidate is scored against its best-fitting variant.
  function rank(title, docs, options = {}) {
    const now = options.now ?? Date.now();
    const maxAgeDays = options.maxAgeDays ?? MAX_AGE_DAYS;
    const extendedMaxAgeDays = options.extendedMaxAgeDays ?? EXTENDED_MAX_AGE_DAYS;
    const sources = (options.sources ?? ['SPIEGEL Plus']).map(normalize);
    const variants = (options.variants?.length ? options.variants : [title]).map(variant => ({ original: normalize(variant), wanted: tokens(variant) }));
    const unique = new Map();
    const unexpected = new Set();
    for (const doc of docs) {
      if (!doc || typeof doc.documentId !== 'string' || !/^[A-Za-z0-9_.:-]+$/.test(doc.documentId)) continue;
      const f = doc.fields || {};
      const sourceRank = sources.indexOf(normalize(f.QUELLENNAME));
      if (sourceRank < 0) { if (f.QUELLENNAME) unexpected.add(String(f.QUELLENNAME).slice(0, 60)); continue; }
      const candidateTitle = String(f.ARTIKELTITEL || f['TL-TITEL'] || '');
      const candidate = tokens(candidateTitle);
      const normalized = normalize(candidateTitle);
      let best = null;
      for (const { original, wanted } of variants) {
        const overlap = wanted.filter(w => candidate.includes(w)).length;
        const precision = candidate.length ? overlap / candidate.length : 0;
        const recall = wanted.length ? overlap / wanted.length : 0;
        const score = precision + recall ? 2 * precision * recall / (precision + recall) : 0;
        const exact = normalized === original;
        const fit = { score: exact ? 1 : score, exact, wantedLength: wanted.length };
        if (!best || fit.score > best.score || (fit.score === best.score && fit.exact && !best.exact)) best = fit;
      }
      const date = f.ERSCHEINUNGSDATUM || '';
      unique.set(doc.documentId, { id: doc.documentId, title: candidateTitle, date, time: parseDate(date), source: String(f.QUELLENNAME), sourceRank, ...best });
    }
    const ranked = [...unique.values()].sort((a, b) => b.score - a.score);
    // Stale or undated candidates are dropped before judging the lead, so an old edition of a
    // recurring title cannot be linked, and cannot block the current edition either.
    const winner = decide(collapse(ranked.filter(candidate => isFresh(candidate.time, now, maxAgeDays))));
    if (winner) return { kind: 'match', candidate: winner };
    // Nothing matched in the normal window: look again at the same results in the wider window.
    // Ties and weak leads still fail, and a loose (non-exact) old match is never trusted.
    const older = decide(collapse(ranked.filter(candidate => isFresh(candidate.time, now, extendedMaxAgeDays))));
    if (older?.exact) return { kind: 'match', candidate: older, extended: true };
    const unguarded = decide(collapse(ranked));
    const reason = unguarded ? (unguarded.time === null ? 'undated' : 'stale') : undefined;
    // Results exist but none came from an expected source: report the names (publication names
    // only) so a mismatch between the request filter and the response field is easy to spot.
    const unexpectedSources = ranked.length === 0 && unexpected.size ? [...unexpected].slice(0, 5) : undefined;
    // Numbers only, for diagnosing why nothing matched: how many results Genios returned, how many came
    // from expected sources, and how close the best one was.
    const stats = { results: docs.length, accepted: ranked.length, bestScore: ranked.length ? Math.round(ranked[0].score * 100) / 100 : 0, bestExact: ranked.length ? ranked[0].exact : false };
    return { kind: 'search', candidates: ranked.slice(0, 3), reason, unexpectedSources, stats };
  }
  return { normalize, tokens, query, queryFor, parseDate, rank, MAX_AGE_DAYS, EXTENDED_MAX_AGE_DAYS };
})();
if (typeof module !== 'undefined') module.exports = globalThis.VoebbMatch;
