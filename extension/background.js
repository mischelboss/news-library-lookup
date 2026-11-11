const ORIGIN = 'https://bib-voebb.genios.de';
const inflight = new Map();
let tail = Promise.resolve();
// Failure cooldown per publisher: a problem that only affects one publisher's search must not
// silence the others. Each entry is { until, message }.
const pauses = new Map();
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

// One parameter set builds both the JSON API request and the manual search link. The query and the
// sources come from the publisher adapter in this extension, never from a message.
function searchParams(publisher, title) {
  const params = new URLSearchParams();
  params.append('requestText', VoebbMatch.queryFor(publisher.titleVariants(title)));
  for (const source of publisher.sources) params.append('source', source);
  params.append('size', '10');
  params.append('sort', 'BY_DATE');
  params.append('order', 'desc');
  params.append('resultListType', 'DEFAULT');
  return params;
}

function genioUrl(path, publisher, title) {
  const url = new URL(path, ORIGIN);
  url.search = searchParams(publisher, title);
  return url;
}

const apiUrl = (publisher, title) => genioUrl('/api/searchResult/Alle', publisher, title);
const searchUrl = (publisher, title) => genioUrl('/searchResult/Alle', publisher, title).href;

// The cache key includes the publisher, so equal headlines on different sites never share a result.
async function keyFor(publisher, title) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${publisher.id}\n${VoebbMatch.normalize(title)}`));
  return Array.from(new Uint8Array(bytes), n => n.toString(16).padStart(2, '0')).join('');
}

function searchMessage(publisher, result) {
  if (result.kind === 'match') return `Strong title match in ${publisher.label}. Full-text access depends on your VÖBB session.`;
  if (result.reason === 'stale') return `The closest title match is more than ${VoebbMatch.EXTENDED_MAX_AGE_DAYS} days old, so it may be a different edition. Search Genios to check manually.`;
  if (result.reason === 'undated') return 'The closest title match has no readable date, so it is not linked directly. Search Genios to check manually.';
  return 'No sufficiently confident match. Search Genios to check manually.';
}

async function fetchDocuments(publisher, title, controller) {
  let response;
  try {
    response = await fetch(apiUrl(publisher, title), { credentials: 'include', redirect: 'error', cache: 'no-store', headers: { Accept: 'application/json' }, signal: controller.signal });
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

async function lookup(publisher, title) {
  const state = await ready;
  if (!state.enabled) return { kind: 'disabled' };
  const pause = pauses.get(publisher.id);
  if (pause && Date.now() < pause.until) return { kind: 'unavailable', url: ORIGIN, message: pause.message };
  if (!(await browser.permissions.contains({ origins: [`${ORIGIN}/*`] }))) {
    lastStatus = 'Allow this extension to access VÖBB Genios in Firefox’s extension permissions.';
    return { kind: 'unavailable', url: ORIGIN, message: lastStatus };
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const documents = await fetchDocuments(publisher, title, controller);
    const result = VoebbMatch.rank(title, documents, { now: Date.now(), sources: publisher.sources, variants: publisher.titleVariants(title) });
    if (!state.enabled) return { kind: 'disabled' };
    lastStatus = 'Background search is working.';
    if (result.reason) console.info(`[spiegel-voebb] direct match withheld: ${result.reason}`);
    // Counts and a score only (no titles): enough to tell "Genios returned nothing" from "wrong source" from "titles differ".
    if (result.stats) console.info(`[spiegel-voebb] ${publisher.id}: no direct match (results ${result.stats.results}, from expected sources ${result.stats.accepted}, best score ${result.stats.bestScore}${result.stats.bestExact ? ', exact' : ''})`);
    if (result.extended) console.info('[spiegel-voebb] matched an older article in the extended window');
    // Publication names only, to make a mismatch between the sources we ask for and the names Genios returns visible.
    if (result.unexpectedSources) console.info(`[spiegel-voebb] ${publisher.id}: results came from unexpected sources: ${result.unexpectedSources.join(', ')}`);
    return {
      kind: result.kind,
      url: result.kind === 'match' ? `${ORIGIN}/document/${encodeURIComponent(result.candidate.id)}` : searchUrl(publisher, title),
      matchedTitle: result.candidate?.title,
      date: result.candidate?.date,
      reason: result.reason,
      extended: result.extended,
      message: searchMessage(publisher, result),
    };
  } catch (error) {
    const category = error?.category || (controller.signal.aborted ? 'timeout' : 'internal');
    const label = category === 'http' && error.status ? `HTTP ${error.status}` : category;
    console.warn(`[spiegel-voebb] ${publisher.id} search failed: ${label}`);
    lastStatus = `Search unavailable (${label}). ${HINTS[category]} Searches pause for one minute after a failure.`;
    pauses.set(publisher.id, { until: Date.now() + 60000, message: lastStatus });
    return { kind: 'unavailable', url: ORIGIN, message: lastStatus };
  } finally { clearTimeout(timeout); }
}

async function schedule(publisher, title) {
  const state = await ready;
  if (!state.enabled) return { kind: 'disabled' };
  const key = await keyFor(publisher, title);
  if (state.cache[key]?.expires > Date.now()) return { ...state.cache[key].result, cached: true };
  if (inflight.has(key)) return inflight.get(key);
  const generation = epoch;
  const task = tail.then(async () => {
    const result = await lookup(publisher, title);
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
  // The publisher comes from the sender's real URL (exact origin, listed path, top frame), and the
  // message must name that same publisher. A message cannot pick sources, hosts, or paths.
  const publisher = sender.frameId === 0 ? VoebbPublishers.forUrl(sender.url) : null;
  if (message?.type === 'lookup' && publisher && message.publisher === publisher.id && typeof message.title === 'string' && message.title.trim().length >= 8 && message.title.length <= 300) return schedule(publisher, message.title.trim());
  if (!ownPage) return;
  if (message?.type === 'status') return ready.then(state => ({ enabled: state.enabled, cached: Object.values(state.cache).filter(item => item.expires > Date.now()).length, pending: inflight.size, status: lastStatus }));
  if (message?.type === 'toggle') return ready.then(async state => {
    state.enabled = !state.enabled;
    await browser.storage.local.set({ enabled: state.enabled });
    return { enabled: state.enabled };
  });
  if (message?.type === 'reset') return ready.then(async state => {
    epoch += 1; state.cache = {}; pauses.clear(); lastStatus = 'Ready to retry. Reload the news page to scan again.';
    await browser.storage.local.set({ cache: {} });
    return { ok: true };
  });
  // Ends the failure cooldowns and tells open news tabs (through storage) to re-check failed icons.
  if (message?.type === 'retry') return ready.then(async () => {
    pauses.clear(); lastStatus = 'Retrying failed checks.';
    await browser.storage.local.set({ retryToken: Date.now() });
    return { ok: true };
  });
});

// Show the setup and privacy page once, on a fresh install (not on updates or browser starts).
browser.runtime.onInstalled.addListener(details => {
  if (details.reason === 'install') browser.tabs.create({ url: browser.runtime.getURL('onboarding.html') });
});
