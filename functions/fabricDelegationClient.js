'use strict';

/**
 * @fileoverview Client side of the delegation transports: the `/delegations`
 * rendezvous, the `/services/delegation/mailbox`, and a local delegate's
 * `/services/delegation/*` routes. Frames are built and checked by the
 * caller's `Delegation` (`@fabric/core/types/delegation`); these helpers
 * only move `fabric:` strings. Browser-safe: no Node `http`.
 *
 * Every helper resolves (never rejects) with the route's JSON plus
 * `httpStatus`, or `{ ok: false, httpStatus: 0, error }` when the request did
 * not complete.
 */

const delegation = require('@fabric/core/functions/delegation');
const { isAllowedFabricHub, normalizeHubOrigin } = require('./fabricHubAllowlist');

const RENDEZVOUS_PATH = '/delegations';
const MAILBOX_PATH = '/services/delegation/mailbox';
const MAILBOX_HEADER = 'X-Fabric-Mailbox';

/** @private */
async function call (fetchImpl, url, init = {}) {
  const run = fetchImpl || (typeof fetch === 'function' ? fetch : null);
  if (!run) return { ok: false, httpStatus: 0, error: 'fetch unavailable' };
  try {
    const res = await run(url, Object.assign({ cache: 'no-store' }, init, {
      headers: Object.assign({ Accept: 'application/json' }, init.body ? { 'Content-Type': 'application/json' } : {}, init.headers || {})
    }));
    const json = await res.json().catch(() => ({}));
    return Object.assign({ ok: res.ok }, json, { httpStatus: res.status });
  } catch (err) {
    return { ok: false, httpStatus: 0, error: (err && err.message) || 'request failed' };
  }
}

/** @private */
function base (origin) {
  return String(origin || '').replace(/\/$/, '');
}

/**
 * Read a pairing invitation (the offer frame, shown as a QR code or link)
 * and check that its rendezvous is one this client may use.
 * @param {string} uri `fabric:` offer frame.
 * @param {Object} [options]
 * @param {Function} [options.now]
 * @param {Object} [options.allowlist] Passed to `isAllowedFabricHub`.
 * @returns {{ ok: true, linkId: string, rendezvous: string, label: string, network: (string|null), author: string }|{ ok: false, error: string }}
 */
function readLinkInvitation (uri, options = {}) {
  const read = delegation.readLinkOffer(String(uri || '').trim(), { now: typeof options.now === 'function' ? options.now() : undefined });
  if (!read.ok) return read;
  const rendezvous = normalizeHubOrigin(read.offer.origin);
  if (!rendezvous || !isAllowedFabricHub(rendezvous, options.allowlist || {})) {
    return { ok: false, error: 'the invitation names a rendezvous this app does not use' };
  }
  return { ok: true, linkId: read.linkId, rendezvous, label: read.offer.label, network: read.offer.network, author: read.author };
}

/**
 * Open a link on a rendezvous with an offer.
 * @param {string} origin Rendezvous origin.
 * @param {string} frame `fabric:` offer.
 * @param {Object} [options]
 * @param {Function} [options.fetch]
 * @returns {Promise<object>}
 */
function openLink (origin, frame, options = {}) {
  return call(options.fetch, `${base(origin)}${RENDEZVOUS_PATH}`, { method: 'POST', body: JSON.stringify({ frame }) });
}

/**
 * Add the next frame (answer, reveal, grant) to a link.
 * @param {string} origin
 * @param {string} linkId
 * @param {string} frame
 * @param {Object} [options]
 * @param {Function} [options.fetch]
 * @returns {Promise<object>}
 */
function postLinkFrame (origin, linkId, frame, options = {}) {
  return call(options.fetch, `${base(origin)}${RENDEZVOUS_PATH}/${encodeURIComponent(linkId)}/frames`, { method: 'POST', body: JSON.stringify({ frame }) });
}

/**
 * Frames of a link so far (`{ status, frames, expiresAt }`).
 * @param {string} origin
 * @param {string} linkId
 * @param {Object} [options]
 * @param {Function} [options.fetch]
 * @returns {Promise<object>}
 */
function readLink (origin, linkId, options = {}) {
  return call(options.fetch, `${base(origin)}${RENDEZVOUS_PATH}/${encodeURIComponent(linkId)}`, { method: 'GET' });
}

/**
 * Poll a link until it has more than `count` frames, it is gone, or time is up.
 * @param {string} origin
 * @param {string} linkId
 * @param {number} count Frames already seen.
 * @param {Object} [options]
 * @param {Function} [options.fetch]
 * @param {number} [options.intervalMs=1500]
 * @param {number} [options.timeoutMs=180000]
 * @param {Function} [options.signal] `() => boolean`; stop when it returns true.
 * @returns {Promise<object>}
 */
async function waitForLinkFrames (origin, linkId, count, options = {}) {
  const interval = Number(options.intervalMs) > 0 ? Number(options.intervalMs) : 1500;
  const until = Date.now() + (Number(options.timeoutMs) > 0 ? Number(options.timeoutMs) : 180000);
  while (Date.now() < until) {
    if (typeof options.signal === 'function' && options.signal()) return { ok: false, httpStatus: 0, error: 'cancelled' };
    const out = await readLink(origin, linkId, options);
    if (!out.ok) return out;
    if (Array.isArray(out.frames) && out.frames.length > count) return out;
    await new Promise((resolve) => setTimeout(resolve, interval));
  }
  return { ok: false, httpStatus: 0, error: 'timeout' };
}

/**
 * End a link early.
 * @param {string} origin
 * @param {string} linkId
 * @param {string} proof `fabric:` `DELEGATION_MAILBOX_FETCH` from either participant.
 * @param {Object} [options]
 * @param {Function} [options.fetch]
 * @returns {Promise<object>}
 */
function cancelLink (origin, linkId, proof, options = {}) {
  return call(options.fetch, `${base(origin)}${RENDEZVOUS_PATH}/${encodeURIComponent(linkId)}`, { method: 'DELETE', headers: { [MAILBOX_HEADER]: proof } });
}

/**
 * Leave a frame in a mailbox for its addressee.
 * @param {string} origin
 * @param {string} frame
 * @param {Object} [options]
 * @param {string} [options.to] Addressee pubkey (results and revokes).
 * @param {Function} [options.fetch]
 * @returns {Promise<object>}
 */
function postMailbox (origin, frame, options = {}) {
  const body = { frame };
  if (options.to) body.to = options.to;
  return call(options.fetch, `${base(origin)}${MAILBOX_PATH}`, { method: 'POST', body: JSON.stringify(body) });
}

/**
 * Collect frames left for the key that signed `proof`.
 * @param {string} origin
 * @param {string} proof `fabric:` `DELEGATION_MAILBOX_FETCH`.
 * @param {Object} [options]
 * @param {Function} [options.fetch]
 * @returns {Promise<object>} `{ frames: [{ seq, type, hash, frame, at }], next }`
 */
function fetchMailbox (origin, proof, options = {}) {
  return call(options.fetch, `${base(origin)}${MAILBOX_PATH}`, { method: 'GET', headers: { [MAILBOX_HEADER]: proof } });
}

/**
 * Pass a pairing frame to a local delegate (`/services/delegation/links`).
 * @param {string} origin Loopback origin of the delegate.
 * @param {string} frame
 * @param {Object} [options]
 * @param {Function} [options.fetch]
 * @returns {Promise<object>}
 */
function postDelegateLink (origin, frame, options = {}) {
  return call(options.fetch, `${base(origin)}/services/delegation/links`, { method: 'POST', body: JSON.stringify({ frame }) });
}

/**
 * Pass a `DELEGATION_REQUEST` to a local delegate.
 * @param {string} origin
 * @param {string} frame
 * @param {Object} [options]
 * @param {Function} [options.fetch]
 * @returns {Promise<object>} `{ status: 'signed'|'declined'|'pending', result }`
 */
function postDelegateRequest (origin, frame, options = {}) {
  return call(options.fetch, `${base(origin)}/services/delegation/requests`, { method: 'POST', body: JSON.stringify({ frame }) });
}

/**
 * Status of a request a local delegate is holding for its user.
 * @param {string} origin
 * @param {string} hash
 * @param {Object} [options]
 * @param {Function} [options.fetch]
 * @returns {Promise<object>}
 */
function readDelegateRequest (origin, hash, options = {}) {
  return call(options.fetch, `${base(origin)}/services/delegation/requests/${encodeURIComponent(hash)}`, { method: 'GET' });
}

module.exports = {
  RENDEZVOUS_PATH,
  MAILBOX_PATH,
  MAILBOX_HEADER,
  readLinkInvitation,
  openLink,
  postLinkFrame,
  readLink,
  waitForLinkFrames,
  cancelLink,
  postMailbox,
  fetchMailbox,
  postDelegateLink,
  postDelegateRequest,
  readDelegateRequest
};
