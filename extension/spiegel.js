(() => {
  if (!['/', '/index.html'].includes(location.pathname) || window.top !== window) return;
  const seen = new WeakMap();
  let timer;
  const PAID = '[data-flag-domain="spon"] [data-flag-name="plus-paid"], [data-flag-domain="spon"][data-contains-flags~="plus-paid"], svg[data-link-flag="spon_paid"]';
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
  function badge(card, title) {
    const host = document.createElement('div');
    host.dataset.voebbBadge = 'true';
    host.style.cssText = 'display:block;position:relative;z-index:2;margin:8px 16px;';
    const shadow = host.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = ':host{color-scheme:light}a,span{display:inline-block;font:600 12px/1.5 system-ui,sans-serif;padding:5px 9px;border-radius:6px;text-decoration:none;border:1px solid #a9bac8;background:#f4f7fa;color:#28445d}a:focus-visible{outline:3px solid #1674b8;outline-offset:3px}a:hover{text-decoration:underline}a[data-kind="match"]{background:#e5f4ec;color:#155d3a;border-color:#7baf91}a[data-kind="unavailable"]{background:#fff5dc;color:#745015}';
    const label = document.createElement('span');
    label.textContent = 'VÖBB: Prüfung vorgemerkt…';
    label.title = `Suche in SPIEGEL Plus: ${title}`;
    shadow.append(style, label);
    card.append(host);
    // Keep publisher-wide teaser click handlers from overriding our links.
    host.addEventListener('click', event => event.stopPropagation());
    return { host, shadow, label, title };
  }
  async function check(entry) {
    try {
      const result = await browser.runtime.sendMessage({ type: 'lookup', title: entry.title });
      if (!entry.host.isConnected || !result || result.kind === 'disabled') { entry.host.remove(); return; }
      const link = document.createElement('a');
      link.dataset.kind = result.kind;
      link.textContent = result.kind === 'match' ? 'Über VÖBB lesen ↗' : result.kind === 'unavailable' ? 'VÖBB anmelden / erneut prüfen ↗' : 'In Genios suchen ↗';
      const target = new URL(result.url);
      if (target.origin !== 'https://bib-voebb.genios.de') throw new Error('Unexpected link');
      link.href = target.href;
      link.target = '_self';
      link.referrerPolicy = 'no-referrer';
      link.title = result.kind === 'match' ? `Titelübereinstimmung: ${result.matchedTitle}${result.date ? ` (${result.date})` : ''}. Leserechte werden beim Öffnen geprüft.` : result.message;
      entry.label.replaceWith(link);
      entry.label = link;
    } catch { entry.label.textContent = 'VÖBB: Prüfung nicht möglich'; }
  }
  async function scan() {
    const { enabled = true } = await browser.storage.local.get('enabled');
    if (!enabled) return;
    const cards = [...document.querySelectorAll('article[data-target-teaser], article[data-sara-article-id]')];
    cards.sort((a, b) => Math.abs(a.getBoundingClientRect().top) - Math.abs(b.getBoundingClientRect().top));
    for (const card of cards) {
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
  browser.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.enabled) {
      if (changes.enabled.newValue) scan();
      else document.querySelectorAll('[data-voebb-badge]').forEach(el => el.remove());
    }
  });
  new MutationObserver(records => {
    if (!records.some(record => [...record.addedNodes, ...record.removedNodes].some(node => node.nodeType === 1 && !node.matches('[data-voebb-badge]')))) return;
    clearTimeout(timer); timer = setTimeout(scan, 500);
  }).observe(document.body, { childList: true, subtree: true });
  scan();
})();
