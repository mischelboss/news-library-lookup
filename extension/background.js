const ORIGIN = 'https://bib-voebb.genios.de';
const inflight = new Map();
let tail = Promise.resolve();
let pausedUntil = 0;
let lastStatus = 'Ready';
let epoch = 0;
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const ready = browser.storage.local.get({ enabled: true, cache: {} }).then(state => state);

function searchUrl(title) {
  const url = new URL('/searchResult/Alle', ORIGIN);
  url.search = new URLSearchParams({ requestText: VoebbMatch.query(title), source: 'SPIEGEL Plus', size: '10', sort: 'BY_DATE', order: 'desc', resultListType: 'DEFAULT' });
  return url.href;
}

async function keyFor(title) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(VoebbMatch.normalize(title)));
  return Array.from(new Uint8Array(bytes), n => n.toString(16).padStart(2, '0')).join('');
}

async function lookup(title) {
  const state = await ready;
  if (!state.enabled) return { kind: 'disabled' };
  if (Date.now() < pausedUntil) return { kind: 'unavailable', url: ORIGIN, message: lastStatus };
  if (!(await browser.permissions.contains({ origins: [`${ORIGIN}/*`] }))) {
    lastStatus = 'Allow this extension to access VÖBB Genios in Firefox’s extension permissions.';
    return { kind: 'unavailable', url: ORIGIN, message: lastStatus };
  }
  const url = new URL('/api/searchResult/Alle', ORIGIN);
  url.search = new URLSearchParams({ requestText: VoebbMatch.query(title), source: 'SPIEGEL Plus', size: '10', sort: 'BY_DATE', order: 'desc', resultListType: 'DEFAULT' });
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(url, { credentials: 'include', redirect: 'error', cache: 'no-store', headers: { Accept: 'application/json' }, signal: controller.signal });
    if (!response.ok || !(response.headers.get('content-type') || '').includes('application/json')) throw new Error('Session or server unavailable');
    const data = await response.json();
    if (data.errorOccurred || !Array.isArray(data.documents)) throw new Error('Invalid search response');
    const result = VoebbMatch.rank(title, data.documents);
    if (!state.enabled) return { kind: 'disabled' };
    lastStatus = 'Background search is working.';
    return {
      kind: result.kind,
      url: result.kind === 'match' ? `${ORIGIN}/document/${encodeURIComponent(result.candidate.id)}` : searchUrl(title),
      matchedTitle: result.candidate?.title,
      date: result.candidate?.date,
      message: result.kind === 'match' ? 'Strong title match in SPIEGEL Plus. Full-text access depends on your VÖBB session.' : 'No sufficiently confident match. Search Genios to check manually.',
    };
  } catch {
    pausedUntil = Date.now() + 60000;
    lastStatus = 'Search unavailable. Sign in to VÖBB Genios, check site permissions, then retry. Searches pause for one minute after a failure.';
    return { kind: 'unavailable', url: ORIGIN, message: lastStatus };
  } finally { clearTimeout(timeout); }
}

async function schedule(title) {
  const state = await ready;
  if (!state.enabled) return { kind: 'disabled' };
  const key = await keyFor(title);
  if (state.cache[key]?.expires > Date.now()) return { ...state.cache[key].result, cached: true };
  if (inflight.has(key)) return inflight.get(key);
  const generation = epoch;
  const task = tail.then(async () => {
    const result = await lookup(title);
    if (generation === epoch && ['match', 'search'].includes(result.kind)) {
      state.cache[key] = { expires: Date.now() + (result.kind === 'match' ? 6 * 3600000 : 20 * 60000), result };
      const entries = Object.entries(state.cache).filter(([, item]) => item.expires > Date.now()).sort((a, b) => b[1].expires - a[1].expires).slice(0, 400);
      state.cache = Object.fromEntries(entries);
      await browser.storage.local.set({ cache: state.cache });
    }
    return result;
  });
  inflight.set(key, task);
  tail = task.catch(() => {}).then(() => wait(800));
  task.finally(() => inflight.delete(key)).catch(() => {});
  return task;
}

browser.runtime.onMessage.addListener((message, sender) => {
  if (sender.id !== browser.runtime.id) return;
  let source;
  try { source = new URL(sender.url); } catch { return; }
  const ownPage = source.origin === new URL(browser.runtime.getURL('/')).origin;
  const homepage = source.origin === 'https://www.spiegel.de' && ['/', '/index.html'].includes(source.pathname) && sender.frameId === 0;
  if (message?.type === 'lookup' && homepage && typeof message.title === 'string' && message.title.trim().length >= 8 && message.title.length <= 300) return schedule(message.title.trim());
  if (!ownPage) return;
  if (message?.type === 'status') return ready.then(state => ({ enabled: state.enabled, cached: Object.keys(state.cache).length, pending: inflight.size, status: lastStatus }));
  if (message?.type === 'toggle') return ready.then(async state => {
    state.enabled = !state.enabled;
    await browser.storage.local.set({ enabled: state.enabled });
    return { enabled: state.enabled };
  });
  if (message?.type === 'reset') return ready.then(async state => {
    epoch += 1; state.cache = {}; pausedUntil = 0; lastStatus = 'Ready to retry. Reload Spiegel to scan again.';
    await browser.storage.local.set({ cache: {} });
    return { ok: true };
  });
});
