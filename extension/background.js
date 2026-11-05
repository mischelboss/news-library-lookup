const ORIGIN = 'https://bib-voebb.genios.de';
const SOURCE = 'SPIEGEL Plus';
const inflight = new Map();
let tail = Promise.resolve();
let pausedUntil = 0;
let lastStatus = 'Ready';
let epoch = 0;
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const ready = browser.storage.local.get({ enabled: true, cache: {} }).then(state => state);

// Failure categories shown to the user and logged. Never log URLs, queries, headers, cookies, or bodies.
const HINTS = {
  network: 'Genios could not be reached. Sign in to VÖBB Genios again if your session expired, and check your connection.',
  timeout: 'Genios did not answer in time.',
  http: 'Genios answered with an error.',
  'content-type': 'Genios did not return JSON, which usually means the session expired. Sign in again.',
  json: 'Genios returned unreadable data.',
  shape: 'Genios returned an unexpected response format; the website interface may have changed.',
  internal: 'The extension hit an unexpected error.',
};

function failure(category, status) {
  const error = new Error(category);
  error.category = category;
  error.status = status;
  return error;
}

// One parameter set builds both the JSON API request and the manual search link.
function searchParams(title) {
  const params = new URLSearchParams();
  params.append('requestText', VoebbMatch.query(title));
  params.append('source', SOURCE);
  params.append('size', '10');
  params.append('sort', 'BY_DATE');
  params.append('order', 'desc');
  params.append('resultListType', 'DEFAULT');
  return params;
}

function genioUrl(path, title) {
  const url = new URL(path, ORIGIN);
  url.search = searchParams(title);
  return url;
}

const apiUrl = title => genioUrl('/api/searchResult/Alle', title);
const searchUrl = title => genioUrl('/searchResult/Alle', title).href;

async function keyFor(title) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(VoebbMatch.normalize(title)));
  return Array.from(new Uint8Array(bytes), n => n.toString(16).padStart(2, '0')).join('');
}

function searchMessage(result) {
  if (result.kind === 'match') return 'Strong title match in SPIEGEL Plus. Full-text access depends on your VÖBB session.';
  if (result.reason === 'stale') return `The closest title match is more than ${VoebbMatch.MAX_AGE_DAYS} days old, so it may be a different edition. Search Genios to check manually.`;
  if (result.reason === 'undated') return 'The closest title match has no readable date, so it is not linked directly. Search Genios to check manually.';
  return 'No sufficiently confident match. Search Genios to check manually.';
}

async function fetchDocuments(title, controller) {
  let response;
  try {
    response = await fetch(apiUrl(title), { credentials: 'include', redirect: 'error', cache: 'no-store', headers: { Accept: 'application/json' }, signal: controller.signal });
  } catch {
    throw failure(controller.signal.aborted ? 'timeout' : 'network');
  }
  if (!response.ok) throw failure('http', response.status);
  if (!(response.headers.get('content-type') || '').includes('application/json')) throw failure('content-type');
  let data;
  try {
    data = await response.json();
  } catch {
    throw failure(controller.signal.aborted ? 'timeout' : 'json');
  }
  if (!data || data.errorOccurred || !Array.isArray(data.documents)) throw failure('shape');
  return data.documents;
}

async function lookup(title) {
  const state = await ready;
  if (!state.enabled) return { kind: 'disabled' };
  if (Date.now() < pausedUntil) return { kind: 'unavailable', url: ORIGIN, message: lastStatus };
  if (!(await browser.permissions.contains({ origins: [`${ORIGIN}/*`] }))) {
    lastStatus = 'Allow this extension to access VÖBB Genios in Firefox’s extension permissions.';
    return { kind: 'unavailable', url: ORIGIN, message: lastStatus };
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const documents = await fetchDocuments(title, controller);
    const result = VoebbMatch.rank(title, documents, { now: Date.now() });
    if (!state.enabled) return { kind: 'disabled' };
    lastStatus = 'Background search is working.';
    if (result.reason) console.info(`[spiegel-voebb] direct match withheld: ${result.reason}`);
    return {
      kind: result.kind,
      url: result.kind === 'match' ? `${ORIGIN}/document/${encodeURIComponent(result.candidate.id)}` : searchUrl(title),
      matchedTitle: result.candidate?.title,
      date: result.candidate?.date,
      reason: result.reason,
      message: searchMessage(result),
    };
  } catch (error) {
    const category = error?.category || (controller.signal.aborted ? 'timeout' : 'internal');
    const label = category === 'http' && error.status ? `HTTP ${error.status}` : category;
    console.warn(`[spiegel-voebb] search failed: ${label}`);
    pausedUntil = Date.now() + 60000;
    lastStatus = `Search unavailable (${label}). ${HINTS[category]} Searches pause for one minute after a failure.`;
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
  if (message?.type === 'status') return ready.then(state => ({ enabled: state.enabled, cached: Object.values(state.cache).filter(item => item.expires > Date.now()).length, pending: inflight.size, status: lastStatus }));
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
  // Ends the failure cooldown and tells open Spiegel tabs (through storage) to re-check failed badges.
  if (message?.type === 'retry') return ready.then(async () => {
    pausedUntil = 0; lastStatus = 'Retrying failed checks.';
    await browser.storage.local.set({ retryToken: Date.now() });
    return { ok: true };
  });
});
