(() => {
  // Runs on every supported news site; the publisher adapter (publishers.js) says which pages count
  // and how to read a card. Only the homepage-style listing pages in the adapter are processed.
  const publisher = VoebbPublishers.forUrl(location.href);
  if (!publisher || window.top !== window) return;
  const seen = new WeakMap();
  let timer;
  const RETRYABLE = new Set(['unavailable', 'error']);
  const SVG_NS = 'http://www.w3.org/2000/svg';
  // match = found (green), search = not found, search manually (blue), unavailable/error = needs attention (amber).
  const STATES = {
    pending: { color: '#7d8c9b', ink: '#ffffff', label: 'VÖBB: Prüfung vorgemerkt…' },
    match: { color: '#0b9a4d', ink: '#ffffff', label: 'Über VÖBB lesen' },
    search: { color: '#1a6fe0', ink: '#ffffff', label: 'In Genios suchen' },
    unavailable: { color: '#f08c00', ink: '#2b1a00', label: 'VÖBB anmelden / erneut prüfen' },
    error: { color: '#f08c00', ink: '#2b1a00', label: 'VÖBB: Prüfung nicht möglich' },
  };
  function svgEl(name, attrs) {
    const el = document.createElementNS(SVG_NS, name);
    for (const [key, value] of Object.entries(attrs)) el.setAttribute(key, String(value));
    return el;
  }
  // A round 18px icon: colored disc plus a white (or dark, on amber) glyph. Built from DOM nodes only.
  function icon(kind) {
    const { color, ink } = STATES[kind];
    const svg = svgEl('svg', { viewBox: '0 0 24 24', width: 18, height: 18, 'aria-hidden': 'true', focusable: 'false' });
    svg.append(svgEl('circle', { cx: 12, cy: 12, r: 12, fill: color }));
    const stroke = { fill: 'none', stroke: ink, 'stroke-width': 2.4, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' };
    if (kind === 'match') {
      svg.append(svgEl('path', { d: 'M7 12.6l3.3 3.3 6.8-7.2', ...stroke }));
    } else if (kind === 'unavailable' || kind === 'error') {
      svg.append(svgEl('path', { d: 'M12 6.8v6.2', ...stroke }), svgEl('circle', { cx: 12, cy: 17, r: 1.5, fill: ink }));
    } else {
      svg.append(svgEl('circle', { cx: 11, cy: 11, r: 4.6, ...stroke, 'stroke-width': 2.2 }), svgEl('path', { d: 'M14.6 14.6l3.6 3.6', ...stroke }));
    }
    return svg;
  }
  // Non-link states: still checking, or the check itself failed.
  function marker(kind, title) {
    const el = document.createElement('span');
    el.dataset.kind = kind;
    el.setAttribute('role', 'img');
    el.setAttribute('aria-label', STATES[kind].label);
    el.title = kind === 'pending' ? `Suche in ${publisher.label}: ${title}` : STATES[kind].label;
    el.append(icon(kind));
    return el;
  }
  // Link states open Genios in a new tab, so the news page stays where it is.
  function linkFor(kind, href, tooltip) {
    const link = document.createElement('a');
    link.dataset.kind = kind;
    link.href = href;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.referrerPolicy = 'no-referrer';
    link.setAttribute('aria-label', STATES[kind].label);
    link.title = tooltip;
    link.append(icon(kind));
    return link;
  }
  function place(host, { element, mode }) {
    if (mode === 'after') element.after(host); else element.append(host);
  }
  function badge(card, info) {
    const host = document.createElement('span');
    host.dataset.voebbBadge = 'true';
    host.style.cssText = 'display:inline-flex;align-items:center;margin-left:5px;vertical-align:middle;position:relative;z-index:2;';
    const shadow = host.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = ':host{all:initial;display:inline-flex;align-items:center;color-scheme:light}a,span{display:inline-flex;width:18px;height:18px;border-radius:50%;line-height:0}svg{display:block;transition:transform .12s}a:hover svg,a:focus-visible svg{transform:scale(1.15)}a:focus-visible{outline:3px solid #1a6fe0;outline-offset:2px}@media (prefers-reduced-motion:reduce){svg{transition:none}}';
    const label = marker('pending', info.title);
    shadow.append(style, label);
    place(host, info.place);
    // The icon sits inside the publisher's headline link; keep teaser click handlers from hijacking it.
    host.addEventListener('click', event => event.stopPropagation());
    return { host, shadow, label, title: info.title, kind: 'pending' };
  }
  function show(entry, element, kind) {
    entry.label.replaceWith(element);
    entry.label = element;
    entry.kind = kind;
  }
  async function check(entry) {
    try {
      const result = await browser.runtime.sendMessage({ type: 'lookup', publisher: publisher.id, title: entry.title });
      if (!entry.host.isConnected || !result || result.kind === 'disabled') { entry.host.remove(); return; }
      const kind = result.kind === 'match' ? 'match' : result.kind === 'unavailable' ? 'unavailable' : 'search';
      const target = new URL(result.url);
      if (target.origin !== 'https://bib-voebb.genios.de') throw new Error('Unexpected link');
      const tooltip = kind === 'match'
        ? `Titelübereinstimmung: ${result.matchedTitle}${result.date ? ` (${result.date})` : ''}.${result.extended ? ' Älterer Artikel, bitte das Datum prüfen.' : ''} Leserechte werden beim Öffnen geprüft.`
        : result.message;
      show(entry, linkFor(kind, target.href, tooltip), kind);
    } catch {
      show(entry, marker('error', entry.title), 'error');
    }
  }
  function recheck(entry) {
    show(entry, marker('pending', entry.title), 'pending');
    return check(entry);
  }
  // Cards nearest the viewport first, so visible icons resolve first in the sequential queue.
  function sortedCards() {
    return [...document.querySelectorAll(publisher.cards)].sort((a, b) => Math.abs(a.getBoundingClientRect().top) - Math.abs(b.getBoundingClientRect().top));
  }
  async function scan() {
    const { enabled = true } = await browser.storage.local.get('enabled');
    if (!enabled) return;
    for (const card of sortedCards()) {
      const info = publisher.inspect(card);
      const previous = seen.get(card);
      if (!info) { previous?.host.remove(); seen.delete(card); continue; }
      if (previous?.title === info.title && previous.host.isConnected) continue;
      previous?.host.remove();
      const entry = badge(card, info);
      seen.set(card, entry);
      check(entry);
    }
  }
  // Re-check only icons that failed; successful ones keep their result.
  async function retryFailed() {
    const { enabled = true } = await browser.storage.local.get('enabled');
    if (!enabled) return;
    for (const card of sortedCards()) {
      const entry = seen.get(card);
      if (entry?.host.isConnected && RETRYABLE.has(entry.kind)) recheck(entry);
    }
  }
  browser.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (changes.enabled) {
      if (changes.enabled.newValue) scan();
      else document.querySelectorAll('[data-voebb-badge]').forEach(el => el.remove());
    }
    if (changes.retryToken) retryFailed();
  });
  new MutationObserver(records => {
    if (!records.some(record => [...record.addedNodes, ...record.removedNodes].some(node => node.nodeType === 1 && !node.matches('[data-voebb-badge]')))) return;
    clearTimeout(timer); timer = setTimeout(scan, 500);
  }).observe(document.body, { childList: true, subtree: true });
  scan();
})();
