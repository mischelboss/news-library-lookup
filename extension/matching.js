/* Shared pure matching functions: browser background script and Node tests. */
globalThis.VoebbMatch = (() => {
  const STOP = new Set('aber als am an auch auf aus bei das dass dem den der des die ein eine einem einen einer eines er es für im in ist mit nach nicht noch oder sich sie sind so und vom von vor war was wie wir zu zum zur'.split(' '));
  function normalize(value) {
    return String(value || '').normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/ß/g, 'ss').replace(/[^\p{L}\p{N}]+/gu, ' ').trim().replace(/\s+/g, ' ');
  }
  function tokens(value) { return [...new Set(normalize(value).split(' ').filter(w => w.length > 1 && !STOP.has(w)))]; }
  function query(title) { return tokens(title).slice(0, 10).join(' '); }
  function rank(title, docs) {
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
      unique.set(doc.documentId, { id: doc.documentId, title: candidateTitle, date: f.ERSCHEINUNGSDATUM || '', score: exact ? 1 : score, exact });
    }
    const ranked = [...unique.values()].sort((a, b) => b.score - a.score);
    const first = ranked[0], second = ranked[1];
    // Short or generic titles and closely tied candidates never receive a direct badge.
    const strong = Boolean(first && wanted.length >= 3 && (!second || first.score - second.score >= 0.12) && (first.exact || (wanted.length >= 5 && first.score >= 0.94)));
    return strong ? { kind: 'match', candidate: first } : { kind: 'search', candidates: ranked.slice(0, 3) };
  }
  return { normalize, tokens, query, rank };
})();
if (typeof module !== 'undefined') module.exports = globalThis.VoebbMatch;
