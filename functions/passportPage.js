'use strict';

/**
 * @fileoverview Page side of Passport v2 sign-in (browser only, no Node deps).
 *
 * The page checks Passport is there ({@link probePassport}), asks its server
 * for a challenge, hands it to Passport with
 * `window.postMessage({ source: 'fabric-site', type: 'PASSPORT_CHALLENGE',
 * challenge }, origin, [port])`, and reads the answer only from the
 * transferred `MessagePort`: `{ type: 'PASSPORT_ASSERTION', ok: true,
 * assertion }` or `{ ok: false, error }`. Nothing else on the page can see or
 * forge the answer. The server sets the binding cookie with the challenge and
 * checks it when the assertion comes back (`passportHttp`).
 *
 * Peer sessions (v3) need no server route on this page's origin: the page
 * names a peer (its Fabric key and endpoints) with {@link connectPeer},
 * Passport opens the connection, signs in by the peer's key, and keeps the
 * session. The page then acts through Passport with {@link callPeer}
 * (WebSocket peers) or {@link fetchAsPeer} (HTTP peers: Passport signs an
 * `X-Fabric-Request` for that one request); it never holds a token or the
 * session key, and a session answers only the origin that opened it.
 */

/**
 * Attribute older Passports set on every page's `<html>`. Current Passport
 * sets nothing and answers {@link probePassport} instead; the attribute only
 * tells an outdated Passport from none.
 */
const PASSPORT_MARKER = 'data-fabric-passport';
const PASSPORT_PROTOCOL = 2;
const PASSPORT_HELLO_WAIT_MS = 600;
const PASSPORT_MIN_WAIT_MS = 5000;
const PASSPORT_MAX_WAIT_MS = 3 * 60 * 1000 + 30 * 1000;
/** Version of the peer-session page messages. */
const PASSPORT_PEER_PROTOCOL = 3;
const PASSPORT_CALL_WAIT_MS = 30 * 1000;

/**
 * @private
 * @param {Window} win
 * @returns {boolean}
 */
function hasOldMarker (win) {
  const root = win && win.document && win.document.documentElement;
  if (!root || typeof root.getAttribute !== 'function') return false;
  const marker = root.getAttribute(PASSPORT_MARKER);
  return marker !== null && marker !== undefined;
}

/**
 * Ask whether Passport runs on this page: post `{ source: 'fabric-site',
 * type: 'PASSPORT_HELLO', v: 2 }` with a transferred port and wait briefly
 * for `{ type: 'PASSPORT_HELLO', v: 2 }` on it (top-level frames only).
 * @param {Window} win
 * @param {{ timeoutMs: (number|undefined) }} [options]
 * @returns {Promise<'ready'|'outdated'|'missing'>} `outdated`: an older
 *   Passport is installed; ask the user to update it.
 */
function probePassport (win, options = {}) {
  return new Promise((resolve) => {
    if (!win || typeof win.MessageChannel !== 'function' || typeof win.postMessage !== 'function') {
      resolve('missing');
      return;
    }
    const channel = new win.MessageChannel();
    let done = false;
    const finish = (status) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      try { channel.port1.close(); } catch (_) {}
      resolve(status);
    };
    channel.port1.onmessage = (event) => {
      const d = event && event.data;
      if (!d || typeof d !== 'object' || d.type !== 'PASSPORT_HELLO') return;
      finish(Number(d.v) === PASSPORT_PROTOCOL ? 'ready' : 'outdated');
    };
    const wait = Number(options.timeoutMs) > 0 ? Number(options.timeoutMs) : PASSPORT_HELLO_WAIT_MS;
    const timer = setTimeout(() => finish(hasOldMarker(win) ? 'outdated' : 'missing'), wait);
    try {
      win.postMessage({ source: 'fabric-site', type: 'PASSPORT_HELLO', v: PASSPORT_PROTOCOL }, win.location.origin, [channel.port2]);
    } catch (_) {
      finish('missing');
    }
  });
}

/**
 * Whether Passport here can open peer sessions (v3): its hello answer names
 * `peer: 3`. An older Passport never answers {@link connectPeer}, so pages ask
 * this first and fall back to site sign-in.
 * @param {Window} win
 * @param {{ timeoutMs: (number|undefined) }} [options]
 * @returns {Promise<boolean>}
 */
function probePassportPeer (win, options = {}) {
  return new Promise((resolve) => {
    if (!win || typeof win.MessageChannel !== 'function' || typeof win.postMessage !== 'function') {
      resolve(false);
      return;
    }
    const channel = new win.MessageChannel();
    let done = false;
    const finish = (value) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      try { channel.port1.close(); } catch (_) {}
      resolve(value);
    };
    channel.port1.onmessage = (event) => {
      const d = event && event.data;
      if (!d || typeof d !== 'object' || d.type !== 'PASSPORT_HELLO') return;
      finish(Number(d.peer) === PASSPORT_PEER_PROTOCOL);
    };
    const wait = Number(options.timeoutMs) > 0 ? Number(options.timeoutMs) : PASSPORT_HELLO_WAIT_MS;
    const timer = setTimeout(() => finish(false), wait);
    try {
      win.postMessage({ source: 'fabric-site', type: 'PASSPORT_HELLO', v: PASSPORT_PROTOCOL }, win.location.origin, [channel.port2]);
    } catch (_) {
      finish(false);
    }
  });
}

/**
 * Hand a challenge to Passport and wait for its answer on a private port.
 * Resolves (never rejects) with `{ ok: true, assertion }` or
 * `{ ok: false, error }`; `error` is Passport's, or `timeout` / `cancelled`.
 * @param {Window} win
 * @param {Object} params
 * @param {string} params.challenge `fabric:` PASSPORT_CHALLENGE from the server.
 * @param {number} [params.expiresAt] Challenge expiry (ms); bounds the wait.
 * @returns {{ promise: Promise<object>, cancel: function(): void }}
 */
function askPassport (win, params = {}) {
  let finish = () => {};
  const promise = new Promise((resolve) => {
    if (!win || typeof win.MessageChannel !== 'function' || typeof params.challenge !== 'string') {
      resolve({ ok: false, error: 'unsupported' });
      return;
    }
    const channel = new win.MessageChannel();
    let timer = null;
    finish = (result) => {
      finish = () => {};
      clearTimeout(timer);
      try { channel.port1.close(); } catch (_) {}
      resolve(result);
    };
    channel.port1.onmessage = (event) => {
      const d = event && event.data;
      if (!d || typeof d !== 'object') return;
      if (d.ok === true && d.type === 'PASSPORT_ASSERTION' && typeof d.assertion === 'string') {
        finish({ ok: true, assertion: d.assertion });
      } else if (d.ok === false) {
        finish({ ok: false, error: typeof d.error === 'string' && d.error ? d.error : 'rejected' });
      }
    };
    const left = Number(params.expiresAt) - Date.now();
    const wait = Math.min(PASSPORT_MAX_WAIT_MS, Math.max(PASSPORT_MIN_WAIT_MS, Number.isFinite(left) ? left : 0));
    timer = setTimeout(() => finish({ ok: false, error: 'timeout' }), wait);
    win.postMessage(
      { source: 'fabric-site', type: 'PASSPORT_CHALLENGE', challenge: params.challenge },
      win.location.origin,
      [channel.port2]
    );
  });
  return { promise, cancel: () => finish({ ok: false, error: 'cancelled' }) };
}

/**
 * Post one request to Passport with a transferred port and wait for an
 * answer on it. Resolves (never rejects) with what `accept` returns, or
 * `{ ok: false, error }`.
 * @private
 */
function postToPassport (win, message, accept, waitMs) {
  return new Promise((resolve) => {
    if (!win || typeof win.MessageChannel !== 'function' || typeof win.postMessage !== 'function') {
      resolve({ ok: false, error: 'unsupported' });
      return;
    }
    const channel = new win.MessageChannel();
    let timer = null;
    const finish = (result) => {
      clearTimeout(timer);
      try { channel.port1.close(); } catch (_) {}
      resolve(result);
    };
    channel.port1.onmessage = (event) => {
      const d = event && event.data;
      if (!d || typeof d !== 'object') return;
      if (d.ok === false) {
        finish({ ok: false, error: typeof d.error === 'string' && d.error ? d.error : 'rejected' });
        return;
      }
      const accepted = accept(d);
      if (accepted) finish(accepted);
    };
    timer = setTimeout(() => finish({ ok: false, error: 'timeout' }), waitMs);
    try {
      win.postMessage(Object.assign({ source: 'fabric-site' }, message), win.location.origin, [channel.port2]);
    } catch (_) {
      finish({ ok: false, error: 'unsupported' });
    }
  });
}

/** @private */
function cleanEndpoints (endpoints) {
  const list = Array.isArray(endpoints) ? endpoints : [endpoints];
  const out = [];
  for (const item of list) {
    try {
      const url = new URL(String(item));
      if (['ws:', 'wss:', 'http:', 'https:'].includes(url.protocol)) out.push(url.href);
    } catch (_) {}
  }
  return out.slice(0, 8);
}

/**
 * Sign in to a peer through Passport: Passport connects to `endpoints`,
 * checks the peer's key, asks the user, and keeps the session.
 * @param {Window} win
 * @param {Object} params
 * @param {string[]} params.endpoints The peer's `ws:` / `wss:` URLs (WebSocket peers) or
 *   `http:` / `https:` origins (HTTP peers), tried in order.
 * @param {string} [params.peer] The peer's compressed pubkey. Omit to let Passport
 *   learn it on first use (Passport shows it and warns).
 * @param {string[]} [params.request] Disclosures to ask for (`wallet`, `cosigner`).
 * @param {string} [params.purpose] Shown in Passport's prompt.
 * @returns {Promise<{ ok: true, session: { sessionId: string, peer: string, identity: { id: string, pubkey: string }, network: string, expiresAt: number, wallet: (object|undefined), cosigner: (object|undefined) } }|{ ok: false, error: string }>}
 */
function connectPeer (win, params = {}) {
  const endpoints = cleanEndpoints(params.endpoints);
  if (!endpoints.length) return Promise.resolve({ ok: false, error: 'no endpoints' });
  const message = {
    type: 'PASSPORT_PEER_CONNECT',
    v: PASSPORT_PEER_PROTOCOL,
    endpoints,
    peer: typeof params.peer === 'string' ? params.peer : undefined,
    request: Array.isArray(params.request) ? params.request : [],
    purpose: typeof params.purpose === 'string' ? params.purpose : undefined
  };
  return postToPassport(win, message, (d) => (
    d.ok === true && d.type === 'PASSPORT_PEER_SESSION' && d.session && typeof d.session.sessionId === 'string'
      ? { ok: true, session: d.session }
      : null
  ), PASSPORT_MAX_WAIT_MS);
}

/**
 * Call a JSON-RPC method on a peer as a session this page opened. Passport
 * signs the call with the session key; the result comes back on a private port.
 * @param {Window} win
 * @param {Object} params
 * @param {string} params.sessionId
 * @param {string} params.method
 * @param {Array} [params.params]
 * @param {number} [params.timeoutMs]
 * @returns {Promise<{ ok: true, result: * }|{ ok: false, error: string }>}
 */
function callPeer (win, params = {}) {
  if (typeof params.sessionId !== 'string' || typeof params.method !== 'string') {
    return Promise.resolve({ ok: false, error: 'sessionId and method required' });
  }
  const message = {
    type: 'PASSPORT_PEER_CALL',
    v: PASSPORT_PEER_PROTOCOL,
    sessionId: params.sessionId,
    method: params.method,
    params: Array.isArray(params.params) ? params.params : []
  };
  const wait = Number(params.timeoutMs) > 0 ? Number(params.timeoutMs) : PASSPORT_CALL_WAIT_MS;
  return postToPassport(win, message, (d) => (
    d.ok === true && d.type === 'PASSPORT_PEER_RESULT' ? { ok: true, result: d.result } : null
  ), wait);
}

/**
 * Ask Passport to authorize one HTTP request to the peer as a session this
 * page opened: an `X-Fabric-Request` value bound to the method, URL path and
 * query, and body. Passport refuses a URL on another origin than the peer's.
 * @param {Window} win
 * @param {Object} params
 * @param {string} params.sessionId
 * @param {string} params.url Absolute URL of the request.
 * @param {string} [params.method='GET']
 * @param {string} [params.body] The body exactly as it will be sent.
 * @returns {Promise<{ ok: true, header: string }|{ ok: false, error: string }>}
 */
function authorizePeerRequest (win, params = {}) {
  if (typeof params.sessionId !== 'string' || typeof params.url !== 'string') {
    return Promise.resolve({ ok: false, error: 'sessionId and url required' });
  }
  if (params.body != null && typeof params.body !== 'string') return Promise.resolve({ ok: false, error: 'body must be a string' });
  const message = {
    type: 'PASSPORT_PEER_AUTHORIZE',
    v: PASSPORT_PEER_PROTOCOL,
    sessionId: params.sessionId,
    url: params.url,
    method: String(params.method || 'GET').toUpperCase(),
    body: params.body == null ? '' : params.body
  };
  return postToPassport(win, message, (d) => (
    d.ok === true && d.type === 'PASSPORT_PEER_AUTHORIZATION' && typeof d.header === 'string' ? { ok: true, header: d.header } : null
  ), PASSPORT_CALL_WAIT_MS);
}

/**
 * `fetch` as a peer session: Passport signs this one request, the page sends
 * it. The body must be a string (it is signed as sent).
 * @param {Window} win
 * @param {Object} params
 * @param {string} params.sessionId
 * @param {string} params.url
 * @param {Object} [params.init] `fetch` init.
 * @param {Function} [params.fetch] Defaults to `window.fetch`.
 * @returns {Promise<Response>} Rejects when Passport refuses.
 */
async function fetchAsPeer (win, params = {}) {
  const init = params.init || {};
  const url = new URL(String(params.url), win && win.location ? win.location.href : undefined).href;
  const auth = await authorizePeerRequest(win, { sessionId: params.sessionId, url, method: init.method || 'GET', body: init.body });
  if (!auth.ok) {
    const err = new Error(auth.error);
    err.code = auth.error;
    throw err;
  }
  const fetchImpl = params.fetch || (win && win.fetch && win.fetch.bind(win));
  const headers = Object.assign({}, init.headers || {}, { 'X-Fabric-Request': auth.header });
  return fetchImpl(url, Object.assign({}, init, { headers }));
}

/**
 * End a peer session this page opened.
 * @param {Window} win
 * @param {{ sessionId: string }} params
 * @returns {Promise<{ ok: boolean, error: (string|undefined) }>}
 */
function closePeer (win, params = {}) {
  if (typeof params.sessionId !== 'string') return Promise.resolve({ ok: false, error: 'sessionId required' });
  return postToPassport(win, { type: 'PASSPORT_PEER_CLOSE', v: PASSPORT_PEER_PROTOCOL, sessionId: params.sessionId }, (d) => (
    d.ok === true && d.type === 'PASSPORT_PEER_CLOSED' ? { ok: true } : null
  ), PASSPORT_MIN_WAIT_MS);
}

/** @private */
async function postJson (fetchImpl, url, body) {
  const res = await fetchImpl(url, {
    method: 'POST',
    credentials: 'same-origin',
    cache: 'no-store',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(body || {})
  });
  const json = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, json };
}

/**
 * Sign in with Passport: challenge, Passport, `POST` the assertion, session.
 * @param {Object} params
 * @param {Window} params.window
 * @param {Function} [params.fetch] Defaults to `window.fetch`.
 * @param {string} [params.base='/sessions'] Route base: `<base>/challenges` and `<base>`.
 * @param {string[]} [params.request] Disclosures to ask for (`wallet`, `cosigner`).
 * @param {string} [params.purpose] Shown in Passport's prompt.
 * @param {Object} [params.extra] Extra fields for the assertion POST body.
 * @param {function({ cancel: Function }): void} [params.onPending] Called once Passport is asked.
 * @returns {Promise<{ ok: boolean, session?: object, body?: object, error?: string, status?: number }>}
 */
async function signInWithPassport (params = {}) {
  const win = params.window;
  const fetchImpl = params.fetch || (win && win.fetch && win.fetch.bind(win));
  const base = String(params.base || '/sessions').replace(/\/$/, '');
  if (!win || !fetchImpl) return { ok: false, error: 'unsupported' };
  const issued = await postJson(fetchImpl, `${base}/challenges`, {
    request: Array.isArray(params.request) ? params.request : [],
    purpose: params.purpose
  });
  if (!issued.ok || typeof issued.json.challenge !== 'string') {
    return { ok: false, status: issued.status, error: issued.json.error || 'challenge failed' };
  }
  const ask = askPassport(win, { challenge: issued.json.challenge, expiresAt: issued.json.expiresAt });
  if (typeof params.onPending === 'function') params.onPending({ cancel: ask.cancel });
  const answer = await ask.promise;
  if (!answer.ok) return { ok: false, error: answer.error };
  const done = await postJson(fetchImpl, base, Object.assign({}, params.extra || {}, { assertion: answer.assertion }));
  if (!done.ok) return { ok: false, status: done.status, error: done.json.error || 'sign-in failed' };
  return { ok: true, session: done.json.session || null, body: done.json };
}

module.exports = {
  PASSPORT_MARKER,
  PASSPORT_PROTOCOL,
  PASSPORT_PEER_PROTOCOL,
  probePassport,
  probePassportPeer,
  askPassport,
  signInWithPassport,
  connectPeer,
  callPeer,
  authorizePeerRequest,
  fetchAsPeer,
  closePeer
};
