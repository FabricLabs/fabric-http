'use strict';

/**
 * Mutual device-link attestations (Passport ↔ Hub ↔ desktop peers).
 *
 * Challenge (both parties BIP340-sign the same UTF-8 string):
 *   fabric:device-link:2:<sessionId>:<64-hex nonce>:<initiatorId>:<responderId>:<label>
 *
 * Flow (Hub rendezvous under `/device-links`):
 * 1. Initiator POST /device-links **without** signature → `{ sessionId, nonce, offerMessage, pollSecret }`
 *    (server-only nonce; client must not send `nonce`).
 * 2. Initiator POST /device-links with `sessionId` + Schnorr over `offerMessage` → `pending`.
 * 3. Responder GET pending, POST …/signatures { role:'responder', … }.
 * 4. Initiator POST …/signatures { role:'initiator', … } countersigns the link message.
 * 5. GET returns status `linked` with both attestations until SESSION_TTL_MS.
 *    Pending/accepted GET stays Origin-gated so the responder (QR `sessionId`
 *    only) can sign. DELETE of pending/accepted requires the create-response
 *    `pollSecret` off-loopback so a captured QR cannot cancel the offer.
 */

const crypto = require('crypto');
const Key = require('@fabric/core/types/key');
const { normalizeHubOrigin, isAllowedFabricHub, isLoopbackHubOrigin } = require('./fabricHubAllowlist');
const {
  fabricIdentityIdFromPubkeyHex,
  verifyIdentitySchnorr,
  isLocalRequest,
  clientMayPollDesktopSession,
  requestMayRedeemSessionSecret
} = require('./fabricSiteLoginVerify');
const {
  DEVICE_LINK_PREFIX,
  DEVICE_LINK_V1_PREFIX,
  DEVICE_LINK_V2_PREFIX,
  isSessionIdHex,
  buildDeviceLinkMessage,
  buildDeviceLinkOfferMessage,
  parseDeviceLinkMessage
} = require('./fabricDeviceLinkMessages');

const SESSION_TTL_MS = 30 * 60 * 1000;
const MAX_SESSIONS = 256;
const MAX_SESSIONS_PER_ORIGIN = 16;
const MAX_CONSUMED_OFFERS = 512;

function randomSessionId () {
  return crypto.randomBytes(24).toString('hex');
}

function randomNonce () {
  return crypto.randomBytes(32).toString('hex');
}

function offerReplayKey (nonce, initiatorId, origin) {
  // Canonical origin so https://HUB.example:443 and https://hub.example collide.
  const originKey = normalizeHubOrigin(origin) || String(origin || '');
  return `${String(nonce || '').toLowerCase()}:${String(initiatorId || '')}:${originKey}`;
}

function ensureConsumedOffers (hub) {
  if (!hub._deviceLinkConsumedOffers) hub._deviceLinkConsumedOffers = new Map();
  return hub._deviceLinkConsumedOffers;
}

function markOfferConsumed (hub, key) {
  const map = ensureConsumedOffers(hub);
  map.set(key, Date.now());
  while (map.size > MAX_CONSUMED_OFFERS) {
    const first = map.keys().next().value;
    map.delete(first);
  }
}

function offerKeyInUse (hub, key) {
  const consumed = ensureConsumedOffers(hub);
  if (consumed.has(key)) return true;
  if (!hub._deviceLinkSessions) return false;
  for (const session of hub._deviceLinkSessions.values()) {
    if (!session) continue;
    if (offerReplayKey(session.nonce, session.initiator && session.initiator.id, session.origin) === key) {
      return true;
    }
  }
  return false;
}

/**
 * Capacitor / local dashboard WebView origins (https://localhost, capacitor://).
 * Device-link create/poll from the Android app hits an allowlisted public hub
 * (relay.goon.vc) whose Origin header will not match the hub.
 */
function isCompanionWebViewOrigin (originLike) {
  const raw = String(originLike || '').trim();
  if (!raw) return false;
  try {
    const u = new URL(raw.includes('://') ? raw : `https://${raw}`);
    if (u.protocol === 'capacitor:' || u.protocol === 'ionic:') return true;
    const origin = normalizeHubOrigin(`${u.protocol}//${u.host}`);
    return !!(origin && isLoopbackHubOrigin(origin));
  } catch (_) {
    return false;
  }
}

/** Passport popup / content-script (`chrome-extension:` / `moz-extension:`). */
function isExtensionOrigin (originLike) {
  const raw = String(originLike || '').trim().toLowerCase();
  return raw.startsWith('chrome-extension:') || raw.startsWith('moz-extension:');
}

function isThinClientOrigin (originLike) {
  return isCompanionWebViewOrigin(originLike) || isExtensionOrigin(originLike);
}

/**
 * Site-login Origin gate, plus thin clients (Android WebView, Passport) talking
 * to an allowlisted hub. Pending/accepted GET still uses this gate so the
 * responder (QR `sessionId` only) can sign. Signed login redeem and device-link
 * cancel additionally require `pollSecret` from the create JSON.
 */
function clientMayAccessDeviceLink (req, sessionOrigin) {
  if (clientMayPollDesktopSession(req, sessionOrigin)) return true;
  if (!isAllowedFabricHub(sessionOrigin)) return false;
  const hdrOrigin = req && req.headers && req.headers.origin;
  if (isThinClientOrigin(hdrOrigin)) return true;
  const ref = req && req.headers && req.headers.referer;
  if (typeof ref === 'string' && ref) {
    try {
      const u = new URL(ref);
      if (isThinClientOrigin(`${u.protocol}//${u.host}`)) return true;
    } catch (_) { /* ignore */ }
  }
  return false;
}

function sendJson (res, status, obj) {
  res.setHeader('Content-Type', 'application/json');
  res.status(status).send(JSON.stringify(obj));
}

function pruneSessions (hub) {
  if (!hub._deviceLinkSessions) return;
  const now = Date.now();
  for (const [id, s] of hub._deviceLinkSessions) {
    if (!s || now - s.createdAt > SESSION_TTL_MS) hub._deviceLinkSessions.delete(id);
  }
  while (hub._deviceLinkSessions.size > MAX_SESSIONS) {
    const first = hub._deviceLinkSessions.keys().next().value;
    hub._deviceLinkSessions.delete(first);
  }
}

/**
 * FIFO-evict oldest sessions for `origin` until under the per-origin cap.
 * Unauthenticated create can otherwise fill MAX_SESSIONS from one Origin.
 * @param {object} hub
 * @param {string} origin
 */
function evictDeviceLinkOriginOverflow (hub, origin) {
  if (!hub._deviceLinkSessions) return;
  const originKey = normalizeHubOrigin(origin) || String(origin || '');
  const ids = [];
  for (const [id, session] of hub._deviceLinkSessions) {
    const sessionOrigin = normalizeHubOrigin(session && session.origin) ||
      String((session && session.origin) || '');
    if (sessionOrigin === originKey) ids.push(id);
  }
  while (ids.length >= MAX_SESSIONS_PER_ORIGIN) {
    const drop = ids.shift();
    hub._deviceLinkSessions.delete(drop);
  }
}

/**
 * Resolve protocol Key + Bech32 identity id from a Fabric-node xpub.
 * Callers must pass the Fabric protocol node xpub (`Identity#fabricKey.xpub` /
 * `buildFabricIdentitySignedPayload`), not a BIP44 account master — hardened
 * Fabric paths cannot be derived from a watch-only master xpub.
 * @param {string} xpub
 * @returns {{ key: object, id: string, pubkeyHex: string }}
 */
function identityFromXpub (xpub) {
  const key = new Key({ xpub: String(xpub || '').trim() });
  const pubkeyHex = String(key.pubkey || '').toLowerCase();
  if (!/^[a-f0-9]{66}$/.test(pubkeyHex)) {
    throw new Error('Invalid xpub');
  }
  return {
    key,
    id: fabricIdentityIdFromPubkeyHex(pubkeyHex),
    pubkeyHex
  };
}

function handleDeviceLinkPrepare (hub, req, res, ctx) {
  const { origin, label, initiatorId, initiatorPubkeyHex, identity } = ctx;
  if (ctx.bodyNonce) {
    sendJson(res, 400, {
      ok: false,
      error: 'client nonce rejected; omit nonce and sign the server offerMessage'
    });
    return;
  }
  const sessionId = randomSessionId();
  const nonce = randomNonce();
  const replayKey = offerReplayKey(nonce, initiatorId, origin);
  if (offerKeyInUse(hub, replayKey)) {
    sendJson(res, 409, {
      ok: false,
      error: 'offer nonce already used for this initiator/origin (replay rejected)'
    });
    return;
  }
  const offerMessage = buildDeviceLinkOfferMessage(sessionId, nonce, initiatorId, label, origin);
  const pollSecret = randomNonce();
  evictDeviceLinkOriginOverflow(hub, origin);
  hub._deviceLinkSessions.set(sessionId, {
    origin,
    nonce,
    pollSecret,
    label,
    createdAt: Date.now(),
    status: 'awaiting_offer',
    initiator: {
      id: initiatorId,
      xpub: identity.xpub,
      pubkeyHex: initiatorPubkeyHex
    },
    offerMessage,
    responder: null,
    initiatorCountersignature: null,
    linkMessage: null
  });
  sendJson(res, 200, {
    ok: true,
    status: 'awaiting_offer',
    sessionId,
    nonce,
    label,
    pollSecret,
    offerMessage,
    initiatorId,
    protocolUrl: `fabric://link?sessionId=${encodeURIComponent(sessionId)}&hub=${encodeURIComponent(origin)}`
  });
}

function handleDeviceLinkCommit (hub, req, res, ctx) {
  const {
    origin,
    label,
    initiatorId,
    initiatorPubkeyHex,
    identity,
    signature,
    pubkeyHex,
    sessionId,
    bodyNonce
  } = ctx;
  if (bodyNonce) {
    sendJson(res, 400, {
      ok: false,
      error: 'client nonce rejected; omit nonce and sign the server offerMessage'
    });
    return;
  }
  if (!sessionId || !isSessionIdHex(sessionId)) {
    sendJson(res, 400, { ok: false, error: 'sessionId required (48 hex chars)' });
    return;
  }
  const session = hub._deviceLinkSessions.get(sessionId);
  if (!session) {
    sendJson(res, 404, { ok: false, error: 'unknown or expired device link' });
    return;
  }
  if (session.status !== 'awaiting_offer') {
    sendJson(res, 409, { ok: false, error: 'session is not awaiting an offer signature' });
    return;
  }
  if (normalizeHubOrigin(session.origin) !== origin) {
    sendJson(res, 403, { ok: false, error: 'origin does not match this session' });
    return;
  }
  if (session.initiator.id !== initiatorId || session.initiator.pubkeyHex !== initiatorPubkeyHex) {
    sendJson(res, 400, { ok: false, error: 'identity does not match prepared session' });
    return;
  }
  const offerVerify = verifyIdentitySchnorr(session.offerMessage, signature, pubkeyHex, {
    id: initiatorId,
    xpub: identity.xpub
  });
  if (!offerVerify.ok) {
    sendJson(res, 400, { ok: false, error: offerVerify.error || 'invalid offer signature' });
    return;
  }
  session.status = 'pending';
  session.initiator.offerSignature = signature.toLowerCase();
  session.initiator.offerMessage = session.offerMessage;
  sendJson(res, 200, {
    ok: true,
    status: 'pending',
    sessionId,
    nonce: session.nonce,
    label: session.label || label,
    pollSecret: session.pollSecret,
    offerMessage: session.offerMessage,
    initiatorId,
    protocolUrl: `fabric://link?sessionId=${encodeURIComponent(sessionId)}&hub=${encodeURIComponent(origin)}`
  });
}

function handleDeviceLinkCreate (hub, req, res) {
  try {
    if (!hub._deviceLinkSessions) hub._deviceLinkSessions = new Map();
    pruneSessions(hub);
    const body = (req && req.body && typeof req.body === 'object') ? req.body : {};
    let origin = typeof body.origin === 'string' ? body.origin.trim() : '';
    if (!origin) {
      const ref = req.headers && req.headers.referer;
      if (typeof ref === 'string' && ref) {
        try {
          const u = new URL(ref);
          origin = `${u.protocol}//${u.host}`;
        } catch (e) {}
      }
    }
    if (!origin) {
      sendJson(res, 400, { ok: false, error: 'origin required' });
      return;
    }
    origin = normalizeHubOrigin(origin);
    if (!origin) {
      sendJson(res, 400, { ok: false, error: 'invalid origin' });
      return;
    }
    if (!isLocalRequest(req) && !clientMayAccessDeviceLink(req, origin)) {
      sendJson(res, 403, { ok: false, error: 'origin does not match this request' });
      return;
    }

    const label = typeof body.label === 'string' && body.label.trim()
      ? body.label.trim().slice(0, 64)
      : 'device';
    const identity = body.identity;
    const signature = typeof body.signature === 'string' ? body.signature.trim() : '';
    const pubkeyHex = typeof body.pubkeyHex === 'string' ? body.pubkeyHex.trim() : '';
    const sessionId = typeof body.sessionId === 'string' ? body.sessionId.trim().toLowerCase() : '';
    const bodyNonce = typeof body.nonce === 'string' && body.nonce.trim() ? body.nonce.trim().toLowerCase() : '';

    if (!identity || typeof identity !== 'object' || !identity.xpub) {
      sendJson(res, 400, { ok: false, error: 'identity.xpub required' });
      return;
    }

    let initiatorId;
    let initiatorPubkeyHex;
    try {
      const resolved = identityFromXpub(identity.xpub);
      initiatorId = resolved.id;
      initiatorPubkeyHex = resolved.pubkeyHex;
    } catch (e) {
      sendJson(res, 400, { ok: false, error: 'invalid initiator xpub' });
      return;
    }
    if (identity.id != null && String(identity.id).trim() && String(identity.id).trim() !== initiatorId) {
      sendJson(res, 400, { ok: false, error: 'Identity id does not match xpub' });
      return;
    }
    if (pubkeyHex && initiatorPubkeyHex !== pubkeyHex.toLowerCase()) {
      sendJson(res, 400, { ok: false, error: 'Public key does not match xpub' });
      return;
    }

    const ctx = {
      body,
      origin,
      label,
      identity,
      initiatorId,
      initiatorPubkeyHex,
      signature,
      pubkeyHex: pubkeyHex || initiatorPubkeyHex,
      sessionId,
      bodyNonce
    };

    if (!signature) {
      handleDeviceLinkPrepare(hub, req, res, ctx);
      return;
    }
    if (!pubkeyHex) {
      sendJson(res, 400, { ok: false, error: 'pubkeyHex and signature required to commit offer' });
      return;
    }
    handleDeviceLinkCommit(hub, req, res, ctx);
  } catch (err) {
    console.error('[HUB:DEVICE-LINK:CREATE]', err && err.stack ? err.stack : err);
    sendJson(res, 500, { ok: false, error: 'device link create failed' });
  }
}

function handleDeviceLinkSign (hub, req, res) {
  try {
    if (!hub._deviceLinkSessions) hub._deviceLinkSessions = new Map();
    pruneSessions(hub);
    const sessionId = req && req.params && req.params.sessionId
      ? String(req.params.sessionId).trim()
      : '';
    if (!sessionId) {
      sendJson(res, 400, { ok: false, error: 'sessionId required' });
      return;
    }
    const session = hub._deviceLinkSessions.get(sessionId);
    if (!session) {
      sendJson(res, 404, { ok: false, error: 'unknown or expired device link' });
      return;
    }
    if (session.status === 'awaiting_offer') {
      sendJson(res, 409, { ok: false, error: 'initiator must commit offer signature before signing roles' });
      return;
    }
    if (!clientMayAccessDeviceLink(req, session.origin)) {
      sendJson(res, 403, { ok: false, error: 'origin does not match this session' });
      return;
    }

    const body = (req && req.body && typeof req.body === 'object') ? req.body : {};
    const role = typeof body.role === 'string' ? body.role.trim() : '';
    const signature = typeof body.signature === 'string' ? body.signature.trim() : '';
    const pubkeyHex = typeof body.pubkeyHex === 'string' ? body.pubkeyHex.trim() : '';
    const identity = body.identity;

    if (role === 'responder') {
      if (session.status !== 'pending' || session.responder) {
        sendJson(res, 409, { ok: false, error: 'responder already set or session not pending' });
        return;
      }
      let responderId;
      try {
        responderId = identityFromXpub(identity && identity.xpub).id;
      } catch (_) {
        sendJson(res, 400, { ok: false, error: 'invalid responder xpub' });
        return;
      }
      if (responderId === session.initiator.id) {
        sendJson(res, 400, { ok: false, error: 'responder must be a different identity' });
        return;
      }
      const linkMessage = buildDeviceLinkMessage(
        sessionId,
        session.nonce,
        session.initiator.id,
        responderId,
        session.label
      );
      const verified = verifyIdentitySchnorr(linkMessage, signature, pubkeyHex, {
        id: responderId,
        xpub: identity.xpub
      });
      if (!verified.ok) {
        sendJson(res, 400, { ok: false, error: verified.error || 'invalid responder signature' });
        return;
      }
      session.responder = {
        id: responderId,
        xpub: identity.xpub,
        pubkeyHex: pubkeyHex.toLowerCase(),
        signature: signature.toLowerCase()
      };
      session.linkMessage = linkMessage;
      session.status = 'accepted';
      session.acceptedAt = Date.now();
      sendJson(res, 200, {
        ok: true,
        sessionId,
        status: 'accepted',
        linkMessage,
        responder: { id: responderId, xpub: identity.xpub }
      });
      return;
    }

    if (role === 'initiator') {
      if (session.status !== 'accepted' || !session.responder || !session.linkMessage) {
        sendJson(res, 409, { ok: false, error: 'waiting for responder before initiator countersign' });
        return;
      }
      const verified = verifyIdentitySchnorr(session.linkMessage, signature, pubkeyHex, {
        id: session.initiator.id,
        xpub: session.initiator.xpub
      });
      if (!verified.ok) {
        sendJson(res, 400, { ok: false, error: verified.error || 'invalid initiator countersignature' });
        return;
      }
      if (pubkeyHex.toLowerCase() !== session.initiator.pubkeyHex) {
        sendJson(res, 400, { ok: false, error: 'countersign pubkey must match offer initiator' });
        return;
      }
      session.initiatorCountersignature = signature.toLowerCase();
      session.status = 'linked';
      session.linkedAt = Date.now();
      markOfferConsumed(hub, offerReplayKey(session.nonce, session.initiator.id, session.origin));
      sendJson(res, 200, {
        ok: true,
        sessionId,
        status: 'linked',
        label: session.label,
        linkMessage: session.linkMessage,
        initiator: { id: session.initiator.id, xpub: session.initiator.xpub },
        responder: { id: session.responder.id, xpub: session.responder.xpub }
      });
      return;
    }

    sendJson(res, 400, { ok: false, error: 'role must be responder or initiator' });
  } catch (err) {
    console.error('[HUB:DEVICE-LINK:SIGN]', err && err.stack ? err.stack : err);
    sendJson(res, 500, { ok: false, error: 'device link sign failed' });
  }
}

function handleDeviceLinkGet (hub, req, res) {
  try {
    if (!hub._deviceLinkSessions) hub._deviceLinkSessions = new Map();
    pruneSessions(hub);
    const sessionId = req && req.params && req.params.sessionId
      ? String(req.params.sessionId).trim()
      : '';
    if (!sessionId) {
      sendJson(res, 400, { ok: false, error: 'sessionId required' });
      return;
    }
    const session = hub._deviceLinkSessions.get(sessionId);
    if (!session) {
      sendJson(res, 404, { ok: false, error: 'unknown or expired device link' });
      return;
    }
    if (!clientMayAccessDeviceLink(req, session.origin)) {
      sendJson(res, 403, { ok: false, error: 'origin does not match this session' });
      return;
    }

    if (session.status === 'awaiting_offer') {
      sendJson(res, 200, {
        ok: true,
        status: 'awaiting_offer',
        kind: 'device_link',
        sessionId,
        origin: session.origin,
        nonce: session.nonce,
        label: session.label,
        offerMessage: session.offerMessage,
        initiator: {
          id: session.initiator.id,
          xpub: session.initiator.xpub,
          pubkeyHex: session.initiator.pubkeyHex
        },
        createdAt: session.createdAt
      });
      return;
    }

    if (session.status === 'pending') {
      sendJson(res, 200, {
        ok: true,
        status: 'pending',
        kind: 'device_link',
        sessionId,
        origin: session.origin,
        nonce: session.nonce,
        label: session.label,
        initiator: {
          id: session.initiator.id,
          xpub: session.initiator.xpub,
          pubkeyHex: session.initiator.pubkeyHex
        },
        offerMessage: session.initiator.offerMessage,
        createdAt: session.createdAt
      });
      return;
    }

    if (session.status === 'accepted') {
      sendJson(res, 200, {
        ok: true,
        status: 'accepted',
        kind: 'device_link',
        sessionId,
        origin: session.origin,
        nonce: session.nonce,
        label: session.label,
        linkMessage: session.linkMessage,
        initiator: {
          id: session.initiator.id,
          xpub: session.initiator.xpub,
          pubkeyHex: session.initiator.pubkeyHex
        },
        responder: {
          id: session.responder.id,
          xpub: session.responder.xpub,
          pubkeyHex: session.responder.pubkeyHex,
          signature: session.responder.signature
        },
        createdAt: session.createdAt,
        acceptedAt: session.acceptedAt
      });
      return;
    }

    if (session.status === 'linked') {
      const payload = {
        ok: true,
        status: 'linked',
        kind: 'device_link',
        sessionId,
        origin: session.origin,
        nonce: session.nonce,
        label: session.label,
        linkMessage: session.linkMessage,
        initiator: {
          id: session.initiator.id,
          xpub: session.initiator.xpub,
          pubkeyHex: session.initiator.pubkeyHex,
          offerSignature: session.initiator.offerSignature,
          countersignature: session.initiatorCountersignature
        },
        responder: {
          id: session.responder.id,
          xpub: session.responder.xpub,
          pubkeyHex: session.responder.pubkeyHex,
          signature: session.responder.signature
        },
        linkedAt: session.linkedAt
      };
      // Keep until pruneSessions TTL so initiator and responder can both read attestations.
      sendJson(res, 200, payload);
      return;
    }

    sendJson(res, 200, { ok: true, status: session.status || 'unknown' });
  } catch (err) {
    console.error('[HUB:DEVICE-LINK:GET]', err && err.stack ? err.stack : err);
    sendJson(res, 500, { ok: false, error: 'device link get failed' });
  }
}

function handleDeviceLinkCancel (hub, req, res) {
  try {
    if (!hub._deviceLinkSessions) hub._deviceLinkSessions = new Map();
    pruneSessions(hub);
    const sessionId = req && req.params && req.params.sessionId
      ? String(req.params.sessionId).trim()
      : '';
    if (!sessionId) {
      sendJson(res, 400, { ok: false, error: 'sessionId required' });
      return;
    }
    const session = hub._deviceLinkSessions.get(sessionId);
    if (!session) {
      sendJson(res, 200, { ok: true, cancelled: true, existed: false });
      return;
    }
    if (!isLocalRequest(req) && !clientMayAccessDeviceLink(req, session.origin)) {
      sendJson(res, 403, { ok: false, error: 'origin does not match this session' });
      return;
    }
    if (!requestMayRedeemSessionSecret(req, session)) {
      sendJson(res, 403, { ok: false, error: 'poll secret required to cancel this session' });
      return;
    }
    if (session.status === 'linked') {
      sendJson(res, 409, { ok: false, error: 'device link is already complete' });
      return;
    }
    if (session.status === 'awaiting_offer') {
      hub._deviceLinkSessions.delete(sessionId);
      sendJson(res, 200, { ok: true, cancelled: true, existed: true });
      return;
    }
    hub._deviceLinkSessions.delete(sessionId);
    sendJson(res, 200, { ok: true, cancelled: true, existed: true });
  } catch (err) {
    console.error('[HUB:DEVICE-LINK:DELETE]', err && err.stack ? err.stack : err);
    sendJson(res, 500, { ok: false, error: 'device link cancel failed' });
  }
}

function mountFabricDeviceLinkHttp (hub) {
  if (!hub._deviceLinkSessions) hub._deviceLinkSessions = new Map();
  hub.http._addRoute('POST', '/device-links/:sessionId/signatures', (req, res) => handleDeviceLinkSign(hub, req, res));
  hub.http._addRoute('DELETE', '/device-links/:sessionId', (req, res) => handleDeviceLinkCancel(hub, req, res));
  hub.http._addRoute('GET', '/device-links/:sessionId', (req, res) => handleDeviceLinkGet(hub, req, res));
  hub.http._addRoute('POST', '/device-links', (req, res) => handleDeviceLinkCreate(hub, req, res));
}

module.exports = {
  DEVICE_LINK_PREFIX,
  DEVICE_LINK_V1_PREFIX,
  DEVICE_LINK_V2_PREFIX,
  SESSION_TTL_MS,
  MAX_SESSIONS,
  MAX_SESSIONS_PER_ORIGIN,
  isSessionIdHex,
  buildDeviceLinkMessage,
  buildDeviceLinkOfferMessage,
  parseDeviceLinkMessage,
  verifyIdentitySchnorr,
  fabricIdentityIdFromPubkeyHex,
  identityFromXpub,
  mountFabricDeviceLinkHttp,
  randomNonce,
  randomSessionId,
  offerReplayKey,
  offerKeyInUse,
  markOfferConsumed,
  isCompanionWebViewOrigin,
  isExtensionOrigin,
  isThinClientOrigin,
  clientMayAccessDeviceLink,
  pruneDeviceLinkSessions: pruneSessions,
  evictDeviceLinkOriginOverflow,
  handleDeviceLinkCancel,
  handleDeviceLinkGet,
  handleDeviceLinkCreate,
  handleDeviceLinkSign,
  handleDeviceLinkPrepare,
  handleDeviceLinkCommit
};
