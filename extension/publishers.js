/* Publisher adapters, shared by the content script and the background script.
 *
 * Each publisher is one entry: where it lives (origin and listing paths), which Genios sources
 * hold its articles, and how to read a card on its pages. The background trusts only this
 * registry: it derives the publisher from the sender's real URL, and content scripts send nothing
 * but a title and a publisher id. Markup knowledge below comes from observing the sites; selectors
 * avoid generated class names.
 */
globalThis.VoebbPublishers = (() => {
  // Invisible characters (soft hyphens inside long words, zero-width spaces) are removed, not turned into spaces.
  const INVISIBLE = /[\u00AD\u200B-\u200D\u2060\uFEFF]/g;
  const squash = value => String(value || '').replace(INVISIBLE, '').trim().replace(/\s+/g, ' ');
  const validTitle = title => title.length >= 8 && title.length <= 300;

  function articleLink(anchor, origin, pathPattern) {
    let url;
    try { url = new URL(anchor.href); } catch { return false; }
    return url.origin === origin && pathPattern.test(url.pathname);
  }

  // --- Spiegel -------------------------------------------------------------------------------
  const SPIEGEL_PAID = '[data-flag-domain="spon"] [data-flag-name="plus-paid"], [data-flag-domain="spon"][data-contains-flags~="plus-paid"], svg[data-link-flag="spon_paid"]';
  // The paid "+" sits inside the headline link; our icon goes right after it.
  const SPIEGEL_FLAG_ICON = '[data-flag-domain="spon"] [data-flag-name="plus-paid"], svg[data-link-flag="spon_paid"]';
  const SPIEGEL_FLAG_WRAPPER = '[data-flag-domain="spon"][data-contains-flags~="plus-paid"]';
  const spiegel = {
    id: 'spiegel',
    label: 'SPIEGEL Plus',
    origin: 'https://www.spiegel.de',
    listingPaths: ['/', '/index.html'],
    sources: ['SPIEGEL Plus'],
    cards: 'article[data-target-teaser], article[data-sara-article-id]',
    inspect(card) {
      if (!card.querySelector(SPIEGEL_PAID)) return null;
      const anchor = card.querySelector('h2 a[href], h3 a[href]');
      // Article paths end in `slug-a-<id>`, or just `a-<id>` when there is no slug.
      if (!anchor || !articleLink(anchor, this.origin, /(?:^|[/-])a-[\w-]+(?:\.html)?$/)) return null;
      const title = squash(card.getAttribute('aria-label') || anchor.getAttribute('title') || anchor.textContent);
      if (!validTitle(title)) return null;
      const flag = card.querySelector(SPIEGEL_FLAG_ICON);
      const place = flag ? { element: flag, mode: 'after' } : { element: card.querySelector(SPIEGEL_FLAG_WRAPPER) || card, mode: 'append' };
      return { title, place };
    },
    titleVariants: title => [title],
  };

  // --- Tagesspiegel --------------------------------------------------------------------------
  // Paid cards carry a small icon followed by the hidden text "Tagesspiegel Plus", inside the
  // headline link. The headline reads "kicker: headline" (separate spans inside one h2).
  const TSP_PAID_LABEL = 'Tagesspiegel Plus';
  const tagesspiegel = {
    id: 'tagesspiegel',
    label: 'Tagesspiegel',
    origin: 'https://www.tagesspiegel.de',
    listingPaths: ['/'],
    // Priority order: when the same article exists in several sources, the first one wins.
    sources: ['tagesspiegel.de', 'Der Tagesspiegel', 'Tagesspiegel CHECKPOINT'],
    cards: 'article[data-bi-hook="teaser"]',
    inspect(card) {
      const label = [...card.querySelectorAll('.visually-hidden')].find(el => squash(el.textContent) === TSP_PAID_LABEL);
      if (!label) return null;
      // The paid marker sits inside the headline link, and the heading level varies (h2 on lead
      // teasers, h3 on most others), so start from the marker's link and take whatever heading it holds.
      const anchor = label.closest('a[href]');
      const heading = anchor && anchor.querySelector('h1, h2, h3, h4, h5, h6');
      if (!heading || !articleLink(anchor, this.origin, /-\d+\.html$/)) return null;
      const title = squash(heading.textContent) || squash(anchor.getAttribute('data-gtm-link-text'));
      if (!validTitle(title)) return null;
      return { title, place: { element: label, mode: 'after' } };
    },
    // Genios may store the title with or without the kicker, so try both forms.
    titleVariants(title) {
      const colon = title.indexOf(': ');
      const headline = colon >= 3 ? title.slice(colon + 2).trim() : '';
      return headline.split(' ').length >= 3 ? [title, headline] : [title];
    },
  };

  const all = [spiegel, tagesspiegel];
  const byId = id => all.find(publisher => publisher.id === id) || null;
  // The publisher whose listing page this URL is, or null: exact origin, listed path only.
  function forUrl(href) {
    let url;
    try { url = new URL(href); } catch { return null; }
    const publisher = all.find(candidate => candidate.origin === url.origin);
    return publisher && publisher.listingPaths.includes(url.pathname) ? publisher : null;
  }
  return { all, byId, forUrl };
})();
if (typeof module !== 'undefined') module.exports = globalThis.VoebbPublishers;
