'use strict';

/** Canonical JSON-RPC-like WebSocket call message type. */
const JSON_CALL_CANONICAL_TYPE = 'JSONCall';
/** Legacy/alternate wire labels accepted for JSON call messages. */
const JSON_CALL_ALIASES = Object.freeze([JSON_CALL_CANONICAL_TYPE, 'JSON_CALL']);
/** Canonical keepalive ping type. */
const PING_CANONICAL_TYPE = 'Ping';
/** Keepalive ping aliases (canonical + wire opcode friendly type). */
const PING_ALIASES = Object.freeze([PING_CANONICAL_TYPE, 'P2P_PING']);
/** Canonical keepalive pong type. */
const PONG_CANONICAL_TYPE = 'Pong';
/** Keepalive pong aliases (canonical + wire opcode friendly type). */
const PONG_ALIASES = Object.freeze([PONG_CANONICAL_TYPE, 'P2P_PONG']);
/** Canonical heartbeat control message type. */
const HEARTBEAT_TYPE = 'HEARTBEAT';
/** Canonical generic envelope type. */
const GENERIC_MESSAGE_TYPE = 'GenericMessage';
/** JSON call result envelope method name. */
const JSON_CALL_RESULT_METHOD = 'JSONCallResult';
/** Generic message receipt body type. */
const GENERIC_MESSAGE_RECEIPT_TYPE = 'GenericMessageReceipt';

/** Message types treated as keepalive/system signals (receipt/signature leniency). */
const SYSTEM_MESSAGE_TYPES = Object.freeze([
  HEARTBEAT_TYPE,
  ...PING_ALIASES,
  ...PONG_ALIASES
]);

/**
 * Pull control type from parsed JSON transport object.
 * Supports `{ type }` and `{ "@type" }`.
 *
 * @param {unknown} parsed
 * @returns {string|undefined}
 */
function extractTransportControlType (parsed) {
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return undefined;
  const obj = /** @type {Record<string, unknown>} */ (parsed);
  if (typeof obj.type === 'string' && obj.type) return obj.type;
  if (typeof obj['@type'] === 'string' && obj['@type']) return obj['@type'];
  return undefined;
}

/**
 * @param {unknown} type
 * @returns {boolean}
 */
function isNonCanonicalHeartbeatAlias (type) {
  const t = String(type || '');
  return t.toUpperCase() === HEARTBEAT_TYPE && t !== HEARTBEAT_TYPE;
}

/**
 * @param {unknown} type
 * @returns {boolean}
 */
function isJsonCallType (type) {
  return JSON_CALL_ALIASES.includes(String(type || ''));
}

/**
 * @param {unknown} type
 * @returns {boolean}
 */
function isPingType (type) {
  return PING_ALIASES.includes(String(type || ''));
}

/**
 * @param {unknown} type
 * @returns {boolean}
 */
function isPongType (type) {
  return PONG_ALIASES.includes(String(type || ''));
}

/**
 * @param {unknown} type
 * @returns {boolean}
 */
function isSystemMessageType (type) {
  return SYSTEM_MESSAGE_TYPES.includes(String(type || ''));
}

/**
 * Normalize accepted aliases to canonical switch labels.
 *
 * @param {unknown} type
 * @returns {string}
 */
function normalizeTransportType (type) {
  const t = String(type || '');
  if (isJsonCallType(t)) return JSON_CALL_CANONICAL_TYPE;
  if (isPingType(t)) return PING_CANONICAL_TYPE;
  if (isPongType(t)) return PONG_CANONICAL_TYPE;
  if (t === HEARTBEAT_TYPE) return HEARTBEAT_TYPE;
  if (t === GENERIC_MESSAGE_TYPE) return GENERIC_MESSAGE_TYPE;
  return t;
}

module.exports = {
  JSON_CALL_CANONICAL_TYPE,
  JSON_CALL_ALIASES,
  PING_CANONICAL_TYPE,
  PING_ALIASES,
  PONG_CANONICAL_TYPE,
  PONG_ALIASES,
  HEARTBEAT_TYPE,
  GENERIC_MESSAGE_TYPE,
  JSON_CALL_RESULT_METHOD,
  GENERIC_MESSAGE_RECEIPT_TYPE,
  SYSTEM_MESSAGE_TYPES,
  extractTransportControlType,
  isNonCanonicalHeartbeatAlias,
  isJsonCallType,
  isPingType,
  isPongType,
  isSystemMessageType,
  normalizeTransportType
};
