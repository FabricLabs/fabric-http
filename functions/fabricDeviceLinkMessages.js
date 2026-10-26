'use strict';

/**
 * Pure message builders for mutual device-link (browser-safe).
 * Keep free of Node built-ins and Hub HTTP so webpack can include this in the SPA.
 *
 * v3 is the only version. Both strings name the Hub session, its nonce, and the
 * origin the offer was made for, and are BIP340-signed over
 * `taggedHash(DEVICE_LINK_OFFER_TAG | DEVICE_LINK_TAG, utf8)`:
 *   fabric:device-link:3:offer:<sessionId>:<nonce>:<initiatorId>:<label>:<origin>
 *   fabric:device-link:3:link:<sessionId>:<nonce>:<initiatorId>:<responderId>:<label>:<origin>
 * Signers build these strings themselves from the session fields; they never
 * sign a string a Hub hands them.
 */

const DEVICE_LINK_PREFIX = 'fabric:device-link:3';
const DEVICE_LINK_OFFER_TAG = 'Fabric/DeviceLinkOffer';
const DEVICE_LINK_TAG = 'Fabric/DeviceLink';

const SESSION_ID_HEX_LEN = 48;
const NONCE_HEX_LEN = 64;
const IDENTITY_ID_PATTERN = /^id1[qpzry9x8gf2tvdw0s3jn54khce6mua7l]{6,100}$/;

function isSessionIdHex (value) {
  return /^[a-f0-9]{48}$/i.test(String(value || '').trim());
}

function isNonceHex (value) {
  return /^[a-f0-9]{64}$/i.test(String(value || '').trim());
}

function isIdentityId (value) {
  return typeof value === 'string' && IDENTITY_ID_PATTERN.test(value);
}

/**
 * Label as signed: no separators or control / bidi characters, at most 64 chars.
 * @param {string} label
 * @returns {string}
 */
function safeLabel (label) {
  const cleaned = String(label || '')
    .replace(/[\u0000-\u001f\u007f-\u009f\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, '')
    .replace(/:/g, '-')
    .trim()
    .slice(0, 64);
  return cleaned || 'device';
}

/**
 * Canonical http(s) origin, or null.
 * @param {string} origin
 * @returns {string|null}
 */
function normalizeLinkOrigin (origin) {
  try {
    const u = new URL(String(origin || '').trim());
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
    return u.origin;
  } catch (_) {
    return null;
  }
}

function _fields (sessionId, nonce, ids, origin) {
  const sid = String(sessionId || '').trim().toLowerCase();
  const n = String(nonce || '').trim().toLowerCase();
  if (!isSessionIdHex(sid)) throw new Error('sessionId must be 48 hex chars');
  if (!isNonceHex(n)) throw new Error('nonce must be 64 hex chars');
  for (const id of ids) {
    if (!isIdentityId(id)) throw new Error('identity ids must be Fabric id1… strings');
  }
  const o = normalizeLinkOrigin(origin);
  if (!o) throw new Error('origin must be an http(s) origin');
  return { sid, n, o };
}

/**
 * Offer the initiator signs when committing a pending link.
 * @param {string} sessionId 48-hex Hub session id
 * @param {string} nonce 64-hex
 * @param {string} initiatorId Fabric Identity.id
 * @param {string} label
 * @param {string} origin origin the offer was made for
 * @returns {string}
 */
function buildDeviceLinkOfferMessage (sessionId, nonce, initiatorId, label, origin) {
  const { sid, n, o } = _fields(sessionId, nonce, [initiatorId], origin);
  return `${DEVICE_LINK_PREFIX}:offer:${sid}:${n}:${initiatorId}:${safeLabel(label)}:${o}`;
}

/**
 * Link both parties sign once the responder has answered the offer.
 * @param {string} sessionId 48-hex Hub session id
 * @param {string} nonce 64-hex
 * @param {string} initiatorId Fabric Identity.id
 * @param {string} responderId Fabric Identity.id
 * @param {string} label
 * @param {string} origin origin the offer was made for
 * @returns {string}
 */
function buildDeviceLinkMessage (sessionId, nonce, initiatorId, responderId, label, origin) {
  const { sid, n, o } = _fields(sessionId, nonce, [initiatorId, responderId], origin);
  if (initiatorId === responderId) throw new Error('responder must be a different identity');
  return `${DEVICE_LINK_PREFIX}:link:${sid}:${n}:${initiatorId}:${responderId}:${safeLabel(label)}:${o}`;
}

/**
 * Parse a v3 offer or link string; anything else is null.
 * @param {string} msg
 * @returns {object|null} `{ kind: 'offer'|'link', sessionId, nonce, initiatorId, responderId?, label, origin }`
 */
function parseDeviceLinkMessage (msg) {
  const s = String(msg || '');
  const offer = s.match(/^fabric:device-link:3:offer:([a-f0-9]{48}):([a-f0-9]{64}):(id1[a-z0-9]+):([^:]*):(https?:\/\/.+)$/);
  if (offer) {
    const parsed = { kind: 'offer', sessionId: offer[1], nonce: offer[2], initiatorId: offer[3], label: offer[4], origin: offer[5] };
    try {
      return buildDeviceLinkOfferMessage(parsed.sessionId, parsed.nonce, parsed.initiatorId, parsed.label, parsed.origin) === s ? parsed : null;
    } catch (_) {
      return null;
    }
  }
  const link = s.match(/^fabric:device-link:3:link:([a-f0-9]{48}):([a-f0-9]{64}):(id1[a-z0-9]+):(id1[a-z0-9]+):([^:]*):(https?:\/\/.+)$/);
  if (link) {
    const parsed = {
      kind: 'link',
      sessionId: link[1],
      nonce: link[2],
      initiatorId: link[3],
      responderId: link[4],
      label: link[5],
      origin: link[6]
    };
    try {
      return buildDeviceLinkMessage(parsed.sessionId, parsed.nonce, parsed.initiatorId, parsed.responderId, parsed.label, parsed.origin) === s ? parsed : null;
    } catch (_) {
      return null;
    }
  }
  return null;
}

module.exports = {
  DEVICE_LINK_PREFIX,
  DEVICE_LINK_OFFER_TAG,
  DEVICE_LINK_TAG,
  SESSION_ID_HEX_LEN,
  NONCE_HEX_LEN,
  IDENTITY_ID_PATTERN,
  isSessionIdHex,
  isNonceHex,
  isIdentityId,
  safeLabel,
  normalizeLinkOrigin,
  buildDeviceLinkMessage,
  buildDeviceLinkOfferMessage,
  parseDeviceLinkMessage
};
