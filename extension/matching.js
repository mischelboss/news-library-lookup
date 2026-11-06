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
  function normalize(value) {
    return String(value || '').normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/ß/g, 'ss').replace(/[^\p{L}\p{N}]+/gu, ' ').trim().replace(/\s+/g, ' ');
  }
  function tokens(value) { return [...new Set(normalize(value).split(' ').filter(w => w.length > 1 && !STOP.has(w)))]; }
  function query(title) { return tokens(title).slice(0, 10).join(' '); }
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
  // Short or generic titles and closely tied candidates never receive a direct badge.
  function decide(list, wantedLength) {
    const first = list[0], second = list[1];
    const strong = Boolean(first && wantedLength >= 3 && (!second || first.score - second.score >= 0.12) && (first.exact || (wantedLength >= 5 && first.score >= 0.94)));
    return strong ? first : null;
  }
  function rank(title, docs, options = {}) {
    const now = options.now ?? Date.now();
    const maxAgeDays = options.maxAgeDays ?? MAX_AGE_DAYS;
    const extendedMaxAgeDays = options.extendedMaxAgeDays ?? EXTENDED_MAX_AGE_DAYS;
    const original = normalize(title), wanted = tokens(title);
    const unique = new Map();
    for (const doc of docs) {
      if (!doc || typeof doc.documentId !== 'string' || !/^[A-Za-z0-9_.:-]+$/.test(doc.documentId)) continue;
      const f = doc.fields || {};
      if (f.QUELLENNAME !== 'SPIEGEL Plus') continue;
      const candidateTitle = String(f.ARTIKELTITEL || f['TL-TITEL'] || '');
      const candidate = tokens(candidateTitle);
      const overlap = wanted.filter(w => candidate.includes(w)).length;
      const precision = candidate.length ? overlap / candidate.length : 0;
      const recall = wanted.length ? overlap / wanted.length : 0;
      const score = precision + recall ? 2 * precision * recall / (precision + recall) : 0;
      const exact = normalize(candidateTitle) === original;
      const date = f.ERSCHEINUNGSDATUM || '';
      unique.set(doc.documentId, { id: doc.documentId, title: candidateTitle, date, time: parseDate(date), score: exact ? 1 : score, exact });
    }
    const ranked = [...unique.values()].sort((a, b) => b.score - a.score);
    // Stale or undated candidates are dropped before judging the lead, so an old edition of a
    // recurring title cannot be linked, and cannot block the current edition either.
    const fresh = ranked.filter(candidate => isFresh(candidate.time, now, maxAgeDays));
    const winner = decide(fresh, wanted.length);
    if (winner) return { kind: 'match', candidate: winner };
    // Nothing matched in the normal window: look again at the same results in the wider window.
    // Ties and weak leads still fail, and a loose (non-exact) old match is never trusted.
    const older = decide(ranked.filter(candidate => isFresh(candidate.time, now, extendedMaxAgeDays)), wanted.length);
    if (older?.exact) return { kind: 'match', candidate: older, extended: true };
    const unguarded = decide(ranked, wanted.length);
    const reason = unguarded ? (unguarded.time === null ? 'undated' : 'stale') : undefined;
    return { kind: 'search', candidates: ranked.slice(0, 3), reason };
  }
  return { normalize, tokens, query, parseDate, rank, MAX_AGE_DAYS, EXTENDED_MAX_AGE_DAYS };
})();
if (typeof module !== 'undefined') module.exports = globalThis.VoebbMatch;
