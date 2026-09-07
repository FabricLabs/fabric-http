'use strict';

/**
 * Pure message builders for mutual device-link (browser-safe).
 * Keep free of Node built-ins and Hub HTTP so webpack can include this in the SPA.
 *
 * v2 binds `sessionId` (48-hex) into offer + link attest strings so captured
 * signatures cannot be replayed under a different Hub session id.
 */

const DEVICE_LINK_V1_PREFIX = 'fabric:device-link:1';
const DEVICE_LINK_V2_PREFIX = 'fabric:device-link:2';
/** @deprecated use DEVICE_LINK_V2_PREFIX */
const DEVICE_LINK_PREFIX = DEVICE_LINK_V1_PREFIX;
const DEVICE_LINK_LINK_VERSION = 2;

const SESSION_ID_HEX_LEN = 48;
const NONCE_HEX_LEN = 64;

function isSessionIdHex (value) {
  return /^[a-f0-9]{48}$/i.test(String(value || '').trim());
}

function isNonceHex (value) {
  return /^[a-f0-9]{64}$/i.test(String(value || '').trim());
}

function safeLabel (label) {
  return String(label || 'device').replace(/:/g, '-').slice(0, 64);
}

/**
 * Canonical mutual-link message both parties BIP340-sign (v2).
 * @param {string} sessionId 48-hex Hub session id
 * @param {string} nonce 64-hex
 * @param {string} initiatorId Fabric Identity.id
 * @param {string} responderId
 * @param {string} label
 */
function buildDeviceLinkMessage (sessionId, nonce, initiatorId, responderId, label) {
  const sid = String(sessionId || '').trim().toLowerCase();
  const n = String(nonce || '').trim().toLowerCase();
  if (!isSessionIdHex(sid)) throw new Error('sessionId must be 48 hex chars');
  if (!isNonceHex(n)) throw new Error('nonce must be 64 hex chars');
  return `${DEVICE_LINK_V2_PREFIX}:${sid}:${n}:${initiatorId}:${responderId}:${safeLabel(label)}`;
}

/**
 * Offer preamble the initiator signs when committing a pending link (v2).
 * Format: fabric:device-link:2:offer:<sessionId>:<nonce>:<initiatorId>:<label>:<origin>
 */
function buildDeviceLinkOfferMessage (sessionId, nonce, initiatorId, label, origin) {
  const sid = String(sessionId || '').trim().toLowerCase();
  const n = String(nonce || '').trim().toLowerCase();
  if (!isSessionIdHex(sid)) throw new Error('sessionId must be 48 hex chars');
  if (!isNonceHex(n)) throw new Error('nonce must be 64 hex chars');
  return `${DEVICE_LINK_V2_PREFIX}:offer:${sid}:${n}:${initiatorId}:${safeLabel(label)}:${origin}`;
}

function parseDeviceLinkMessageV1 (rest) {
  if (rest.startsWith('offer:')) return null;
  const nonce = rest.slice(0, NONCE_HEX_LEN);
  if (!isNonceHex(nonce) || rest[NONCE_HEX_LEN] !== ':') return null;
  const after = rest.slice(NONCE_HEX_LEN + 1);
  const parts = after.split(':');
  if (parts.length < 3) return null;
  const initiatorId = parts[0];
  const responderId = parts[1];
  const label = parts.slice(2).join(':');
  if (!initiatorId || !responderId) return null;
  return { version: 1, sessionId: null, nonce, initiatorId, responderId, label };
}

function parseDeviceLinkMessageV2 (rest) {
  if (rest.startsWith('offer:')) return null;
  const sessionId = rest.slice(0, SESSION_ID_HEX_LEN);
  if (!isSessionIdHex(sessionId) || rest[SESSION_ID_HEX_LEN] !== ':') return null;
  const afterSid = rest.slice(SESSION_ID_HEX_LEN + 1);
  const nonce = afterSid.slice(0, NONCE_HEX_LEN);
  if (!isNonceHex(nonce) || afterSid[NONCE_HEX_LEN] !== ':') return null;
  const after = afterSid.slice(NONCE_HEX_LEN + 1);
  const parts = after.split(':');
  if (parts.length < 3) return null;
  const initiatorId = parts[0];
  const responderId = parts[1];
  const label = parts.slice(2).join(':');
  if (!initiatorId || !responderId) return null;
  return {
    version: 2,
    sessionId: sessionId.toLowerCase(),
    nonce: nonce.toLowerCase(),
    initiatorId,
    responderId,
    label
  };
}

function parseDeviceLinkMessage (msg) {
  const s = String(msg || '');
  if (s.startsWith(`${DEVICE_LINK_V2_PREFIX}:`)) {
    return parseDeviceLinkMessageV2(s.slice(DEVICE_LINK_V2_PREFIX.length + 1));
  }
  if (s.startsWith(`${DEVICE_LINK_V1_PREFIX}:`)) {
    return parseDeviceLinkMessageV1(s.slice(DEVICE_LINK_V1_PREFIX.length + 1));
  }
  return null;
}

module.exports = {
  DEVICE_LINK_PREFIX,
  DEVICE_LINK_V1_PREFIX,
  DEVICE_LINK_V2_PREFIX,
  DEVICE_LINK_LINK_VERSION,
  SESSION_ID_HEX_LEN,
  NONCE_HEX_LEN,
  isSessionIdHex,
  isNonceHex,
  buildDeviceLinkMessage,
  buildDeviceLinkOfferMessage,
  parseDeviceLinkMessage
};
