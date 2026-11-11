// Loads extension/background.js into an isolated context with simulated browser APIs and network.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { webcrypto } = require('node:crypto');

const root = path.resolve(__dirname, '../../extension');
const match = require(path.join(root, 'matching.js'));
const publishers = require(path.join(root, 'publishers.js'));
const NOW = Date.UTC(2026, 10, 5, 12); // fixed clock so date-based rules stay deterministic
const TITLE = 'Diese Swing Districts entscheiden über die Macht im Repräsentantenhaus';

function doc(id, name = TITLE, { source = 'SPIEGEL Plus', date = '2026-11-03' } = {}) {
  return { documentId: id, fields: { ARTIKELTITEL: name, QUELLENNAME: source, ERSCHEINUNGSDATUM: date } };
}

function response({ ok = true, status = 200, contentType = 'application/json', body, json } = {}) {
  return { ok, status, headers: { get: () => contentType }, json: json || (async () => body) };
}

function createBackground({ stored = { enabled: true, cache: {} }, documents = [doc('SPPL__a')] } = {}) {
  const clock = { now: NOW };
  const state = { mode: 'ok', status: 503, permission: true, documents, gate: null, calls: [], saved: [], logs: [], tabs: [], stored: JSON.parse(JSON.stringify(stored)) };
  const log = level => (...args) => state.logs.push({ level, text: args.join(' ') });
  const context = {
    VoebbMatch: match, VoebbPublishers: publishers, URL, URLSearchParams, TextEncoder, AbortController, crypto: webcrypto,
    Date: { now: () => clock.now },
    console: { info: log('info'), warn: log('warn'), error: log('error'), log: log('log'), debug: log('debug') },
    // Shorten the queue gap and the request timeout, keep every other delay.
    setTimeout: (fn, ms) => setTimeout(fn, ms === 800 ? 0 : ms === 15000 ? 5 : ms),
    clearTimeout,
    browser: {
      permissions: { contains: async () => state.permission },
      storage: { local: {
        get: async defaults => ({ ...defaults, ...JSON.parse(JSON.stringify(state.stored)) }),
        set: async values => { const copy = JSON.parse(JSON.stringify(values)); state.saved.push(copy); Object.assign(state.stored, copy); },
      } },
      runtime: {
        id: 'test',
        getURL: path => `moz-extension://test/${path === '/' ? '' : path}`,
        onMessage: { addListener: fn => { state.listener = fn; } },
        onInstalled: { addListener: fn => { state.installed = fn; } },
      },
      tabs: { create: async options => { state.tabs.push(options); } },
    },
    fetch: async (url, init) => {
      state.calls.push(url);
      assert.equal(url.hostname, 'bib-voebb.genios.de');
      assert.equal(init.credentials, 'include');
      assert.equal(init.redirect, 'error');
      if (state.gate) await state.gate;
      switch (state.mode) {
        case 'network': throw new TypeError('network');
        case 'hang': await new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))));
        // falls through only if the promise above ever resolved, which it cannot
        case 'html': return response({ contentType: 'text/html' });
        case 'status': return response({ ok: false, status: state.status });
        case 'badjson': return response({ json: async () => { throw new SyntaxError('bad json'); } });
        case 'shape': return response({ body: { errorOccurred: true } });
        default: return response({ body: { errorOccurred: false, documents: state.documents } });
      }
    },
  };
  vm.runInNewContext(fs.readFileSync(path.join(root, 'background.js'), 'utf8'), context);

  const sender = { id: 'test', url: 'https://www.spiegel.de/', frameId: 0 };
  const senders = { spiegel: sender, tagesspiegel: { id: 'test', url: 'https://www.tagesspiegel.de/', frameId: 0 } };
  const popup = { id: 'test', url: 'moz-extension://test/popup.html' };
  const lookup = (title, publisher = 'spiegel') => state.listener({ type: 'lookup', publisher, title }, senders[publisher]);
  const own = message => state.listener(message, popup);
  const advance = ms => { clock.now += ms; };
  const until = async condition => { for (let i = 0; i < 200 && !condition(); i++) await new Promise(resolve => setImmediate(resolve)); assert(condition(), 'condition not reached'); };
  return { state, clock, sender, senders, popup, listener: (...args) => state.listener(...args), lookup, own, advance, until };
}

module.exports = { match, publishers, NOW, TITLE, doc, createBackground };
