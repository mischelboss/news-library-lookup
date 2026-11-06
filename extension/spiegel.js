(() => {
  if (!['/', '/index.html'].includes(location.pathname) || window.top !== window) return;
  const seen = new WeakMap();
  let timer;
  const PAID = '[data-flag-domain="spon"] [data-flag-name="plus-paid"], [data-flag-domain="spon"][data-contains-flags~="plus-paid"], svg[data-link-flag="spon_paid"]';
  // Where our icon goes: right after the paid "+" icon, or at the end of its wrapper.
  const FLAG_ICON = '[data-flag-domain="spon"] [data-flag-name="plus-paid"], svg[data-link-flag="spon_paid"]';
  const FLAG_WRAPPER = '[data-flag-domain="spon"][data-contains-flags~="plus-paid"]';
  const CARDS = 'article[data-target-teaser], article[data-sara-article-id]';
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
  function readCard(card) {
    if (!card.querySelector(PAID)) return null;
    const anchor = card.querySelector('h2 a[href], h3 a[href]');
    if (!anchor) return null;
    let url;
    try { url = new URL(anchor.href); } catch { return null; }
    if (url.origin !== 'https://www.spiegel.de' || !/-a-[\w-]+(?:\.html)?$/.test(url.pathname)) return null;
    const title = (card.getAttribute('aria-label') || anchor.getAttribute('title') || anchor.textContent).trim().replace(/\s+/g, ' ');
    return title.length >= 8 && title.length <= 300 ? title : null;
  }
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
    el.title = kind === 'pending' ? `Suche in SPIEGEL Plus: ${title}` : STATES[kind].label;
    el.append(icon(kind));
    return el;
  }
  // Link states open Genios in a new tab, so the Spiegel page stays where it is.
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
  function place(card, host) {
    const flag = card.querySelector(FLAG_ICON);
    if (flag) { flag.after(host); return; }
    (card.querySelector(FLAG_WRAPPER) || card).append(host);
  }
  function badge(card, title) {
    const host = document.createElement('span');
    host.dataset.voebbBadge = 'true';
    host.style.cssText = 'display:inline-flex;align-items:center;margin-left:5px;vertical-align:middle;position:relative;z-index:2;';
    const shadow = host.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = ':host{all:initial;display:inline-flex;align-items:center;color-scheme:light}a,span{display:inline-flex;width:18px;height:18px;border-radius:50%;line-height:0}svg{display:block;transition:transform .12s}a:hover svg,a:focus-visible svg{transform:scale(1.15)}a:focus-visible{outline:3px solid #1a6fe0;outline-offset:2px}@media (prefers-reduced-motion:reduce){svg{transition:none}}';
    const label = marker('pending', title);
    shadow.append(style, label);
    place(card, host);
    // The icon sits inside Spiegel's headline link; keep teaser click handlers from hijacking it.
    host.addEventListener('click', event => event.stopPropagation());
    return { host, shadow, label, title, kind: 'pending' };
  }
  function show(entry, element, kind) {
    entry.label.replaceWith(element);
    entry.label = element;
    entry.kind = kind;
  }
  async function check(entry) {
    try {
      const result = await browser.runtime.sendMessage({ type: 'lookup', title: entry.title });
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
  // Cards nearest the viewport first, so visible badges resolve first in the sequential queue.
  function sortedCards() {
    return [...document.querySelectorAll(CARDS)].sort((a, b) => Math.abs(a.getBoundingClientRect().top) - Math.abs(b.getBoundingClientRect().top));
  }
  async function scan() {
    const { enabled = true } = await browser.storage.local.get('enabled');
    if (!enabled) return;
    for (const card of sortedCards()) {
      const title = readCard(card);
      const previous = seen.get(card);
      if (!title) { previous?.host.remove(); seen.delete(card); continue; }
      if (previous?.title === title && previous.host.isConnected) continue;
      previous?.host.remove();
      const entry = badge(card, title);
      seen.set(card, entry);
      check(entry);
    }
  }
  // Re-check only badges that failed; successful ones keep their result.
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
