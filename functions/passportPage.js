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
  probePassport,
  askPassport,
  signInWithPassport
};
