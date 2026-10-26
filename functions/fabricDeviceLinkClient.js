'use strict';

/**
 * Browser/Electron helpers for mutual device-link HTTP flow.
 * Signing is left to the caller (unlocked Key / IPC).
 *
 * Must NOT require the Hub server module (`fabricDeviceLink.js`) — that pulls
 * Node `http` via fabricDesktopAuth/httpSpaShell and breaks the SPA webpack bundle.
 */

const {
  DEVICE_LINK_PREFIX,
  DEVICE_LINK_OFFER_TAG,
  DEVICE_LINK_TAG,
  buildDeviceLinkOfferMessage,
  buildDeviceLinkMessage,
  parseDeviceLinkMessage
} = require('./fabricDeviceLinkMessages');
const { applyPollSecretHeader } = require('./httpRequestTrust');
const { verifyIdentitySchnorr } = require('./fabricIdentitySchnorr');

function isBrowserFetchGlobal () {
  return typeof globalThis.window === 'object' && globalThis.window === globalThis;
}

function deviceLinkHeaders (origin, opts = {}) {
  const o = String(origin || '').replace(/\/$/, '');
  const h = { Accept: 'application/json', 'Content-Type': 'application/json' };
  // Fetch forbids client-set Origin/Referer in browsers; they send the real page origin.
  // Node / Electron-main helpers still attach them for loopback and unit tests.
  if (o && !isBrowserFetchGlobal()) {
    h.Origin = o;
    h.Referer = `${o}/`;
  }
  return applyPollSecretHeader(h, opts.pollSecret);
}

/**
 * Prepare a device-link session (server-only nonce + sessionId-bound offer).
 * @param {object} opts
 * @param {string} opts.hubBase
 * @param {string} opts.origin
 * @param {string} [opts.label]
 * @param {{ id: string, xpub: string }} opts.identity
 * @param {typeof fetch} [opts.fetchImpl]
 */
async function prepareDeviceLinkOffer (opts) {
  const fetchImpl = opts.fetchImpl || globalThis.fetch;
  const hubBase = String(opts.hubBase || '').replace(/\/$/, '');
  const origin = String(opts.origin || '').trim().replace(/\/$/, '');
  if (!origin) {
    return { ok: false, error: 'origin required (browser page origin)' };
  }
  const res = await fetchImpl(`${hubBase}/device-links`, {
    method: 'POST',
    headers: deviceLinkHeaders(origin),
    body: JSON.stringify({
      origin,
      label: opts.label || 'device',
      identity: opts.identity
    }),
    cache: 'no-store'
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.ok) {
    return { ok: false, error: (data && data.error) || `HTTP ${res.status}` };
  }
  return { ok: true, ...data };
}

/**
 * Commit a prepared offer with the initiator Schnorr signature.
 * @param {object} opts
 * @param {string} opts.sessionId
 * @param {string} opts.hubBase
 * @param {string} opts.origin
 * @param {{ id: string, xpub: string }} opts.identity
 * @param {string} opts.pubkeyHex
 * @param {string} opts.signature
 * @param {typeof fetch} [opts.fetchImpl]
 */
async function commitDeviceLinkOffer (opts) {
  const fetchImpl = opts.fetchImpl || globalThis.fetch;
  const hubBase = String(opts.hubBase || '').replace(/\/$/, '');
  const origin = String(opts.origin || '').trim().replace(/\/$/, '');
  if (!origin) {
    return { ok: false, error: 'origin required (browser page origin)' };
  }
  const res = await fetchImpl(`${hubBase}/device-links`, {
    method: 'POST',
    headers: deviceLinkHeaders(origin),
    body: JSON.stringify({
      origin,
      sessionId: opts.sessionId,
      label: opts.label || 'device',
      identity: opts.identity,
      pubkeyHex: opts.pubkeyHex,
      signature: opts.signature
    }),
    cache: 'no-store'
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.ok) {
    return { ok: false, error: (data && data.error) || `HTTP ${res.status}` };
  }
  return { ok: true, ...data };
}

/**
 * Check a session's offer before answering it: rebuild the v3 offer from the
 * session fields and verify the initiator's signature over it, with the
 * initiator's pubkey derived from its xpub and its id from that pubkey.
 * @param {object} st session JSON from `GET /device-links/:id`
 * @param {string} [origin] origin the caller expects the offer to name
 * @returns {{ ok: true, initiator: { id: string, xpub: string, pubkeyHex: string }, origin: string }|{ ok: false, error: string }}
 */
function verifyDeviceLinkOffer (st, origin) {
  const initiator = (st && st.initiator) || {};
  let expected;
  try {
    expected = buildDeviceLinkOfferMessage(st.sessionId, st.nonce, initiator.id, st.label, st.origin);
  } catch (err) {
    return { ok: false, error: `malformed device link: ${err.message}` };
  }
  if (origin != null && new URL(String(origin)).origin !== new URL(st.origin).origin) {
    return { ok: false, error: 'device link was offered for another origin' };
  }
  if (st.offerMessage != null && st.offerMessage !== expected) {
    return { ok: false, error: 'offer message does not match the session' };
  }
  const verified = verifyIdentitySchnorr(
    expected,
    String(initiator.offerSignature || ''),
    String(initiator.pubkeyHex || '').toLowerCase(),
    { id: initiator.id, xpub: initiator.xpub },
    DEVICE_LINK_OFFER_TAG
  );
  if (!verified.ok) return { ok: false, error: `offer signature: ${verified.error}` };
  return {
    ok: true,
    origin: new URL(st.origin).origin,
    initiator: { id: initiator.id, xpub: initiator.xpub, pubkeyHex: String(initiator.pubkeyHex).toLowerCase() }
  };
}

/**
 * Check the responder's signature on an accepted session: rebuild the v3 link
 * from the session fields and verify it with the responder's xpub-derived key.
 * @param {object} st session JSON (`accepted` or `linked`)
 * @returns {{ ok: true, linkMessage: string, responder: { id: string, xpub: string, pubkeyHex: string } }|{ ok: false, error: string }}
 */
function verifyDeviceLinkResponder (st) {
  const initiator = (st && st.initiator) || {};
  const responder = (st && st.responder) || {};
  let expected;
  try {
    expected = buildDeviceLinkMessage(st.sessionId, st.nonce, initiator.id, responder.id, st.label, st.origin);
  } catch (err) {
    return { ok: false, error: `malformed device link: ${err.message}` };
  }
  if (st.linkMessage != null && st.linkMessage !== expected) {
    return { ok: false, error: 'link message does not match the session' };
  }
  const verified = verifyIdentitySchnorr(
    expected,
    String(responder.signature || ''),
    String(responder.pubkeyHex || '').toLowerCase(),
    { id: responder.id, xpub: responder.xpub },
    DEVICE_LINK_TAG
  );
  if (!verified.ok) return { ok: false, error: `responder signature: ${verified.error}` };
  return {
    ok: true,
    linkMessage: expected,
    responder: { id: responder.id, xpub: responder.xpub, pubkeyHex: String(responder.pubkeyHex).toLowerCase() }
  };
}

async function fetchDeviceLinkSession (hubBase, sessionId, opts = {}) {
  const fetchImpl = opts.fetchImpl || globalThis.fetch;
  const base = String(hubBase || '').replace(/\/$/, '');
  const origin = String(opts.origin || '').trim().replace(/\/$/, '');
  if (!origin) {
    return { ok: false, error: 'origin required (browser page origin)' };
  }
  const res = await fetchImpl(`${base}/device-links/${encodeURIComponent(sessionId)}`, {
    headers: deviceLinkHeaders(origin, { pollSecret: opts.pollSecret }),
    cache: 'no-store'
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.ok) {
    return { ok: false, status: res.status, error: (data && data.error) || `HTTP ${res.status}` };
  }
  return { ok: true, ...data };
}

/**
 * Drop a pending (or accepted-but-not-linked) session. 404 / already-gone is success
 * so Cancel is always safe. A completed `linked` session returns 409 from the hub.
 * Fetch rejection is `ok: false` — the remote row may still exist.
 */
async function cancelDeviceLinkSession (hubBase, sessionId, opts = {}) {
  const fetchImpl = opts.fetchImpl || globalThis.fetch;
  const base = String(hubBase || '').replace(/\/$/, '');
  const sid = String(sessionId || '').trim();
  if (!base || !sid) return { ok: true, skipped: true };
  const origin = String(opts.origin || base).trim().replace(/\/$/, '');
  try {
    const res = await fetchImpl(`${base}/device-links/${encodeURIComponent(sid)}`, {
      method: 'DELETE',
      headers: deviceLinkHeaders(origin, { pollSecret: opts.pollSecret }),
      cache: 'no-store'
    });
    const data = await res.json().catch(() => ({}));
    if (res.status === 404 || (res.ok && data && data.ok !== false)) {
      return {
        ...data,
        ok: true,
        cancelled: true,
        existed: !!(data && data.existed)
      };
    }
    if (res.status === 409) {
      return { ok: true, cancelled: false, alreadyLinked: true, error: (data && data.error) || 'already linked' };
    }
    return { ok: false, status: res.status, error: (data && data.error) || `HTTP ${res.status}` };
  } catch (err) {
    return {
      ok: false,
      cancelled: false,
      error: (err && err.message) ? String(err.message) : 'cancel failed'
    };
  }
}

async function postDeviceLinkSignature (hubBase, sessionId, body, opts = {}) {
  const fetchImpl = opts.fetchImpl || globalThis.fetch;
  const base = String(hubBase || '').replace(/\/$/, '');
  const origin = String(opts.origin || '').trim().replace(/\/$/, '');
  if (!origin) {
    return { ok: false, status: 400, error: 'origin required (browser page origin)' };
  }
  const res = await fetchImpl(`${base}/device-links/${encodeURIComponent(sessionId)}/signatures`, {
    method: 'POST',
    headers: deviceLinkHeaders(origin),
    body: JSON.stringify(body),
    cache: 'no-store'
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.ok) {
    return { ok: false, status: res.status, error: (data && data.error) || `HTTP ${res.status}` };
  }
  return { ok: true, ...data };
}

module.exports = {
  DEVICE_LINK_PREFIX,
  DEVICE_LINK_OFFER_TAG,
  DEVICE_LINK_TAG,
  buildDeviceLinkOfferMessage,
  buildDeviceLinkMessage,
  parseDeviceLinkMessage,
  verifyDeviceLinkOffer,
  verifyDeviceLinkResponder,
  prepareDeviceLinkOffer,
  commitDeviceLinkOffer,
  fetchDeviceLinkSession,
  postDeviceLinkSignature,
  cancelDeviceLinkSession,
  deviceLinkHeaders
};
