'use strict';

/**
 * @fileoverview One HTTP request made as a Passport peer session: the
 * `X-Fabric-Request` header. HTTP lives here, not in `@fabric/core`; the frame
 * is a core `CONTRACT_MESSAGE` under {@link PASSPORT_REQUEST_CONTRACT}, signed
 * by the session key, with `recipient` the peer, `ref` the session id, and a
 * JSON payload `{ type: 'PassportRequest', v, method, target, bodyHash,
 * nonce, issuedAt, expiresAt }`.
 *
 * It binds the method, the path and query, the sha256 of the body bytes, and
 * a nonce the peer accepts once, for at most {@link PASSPORT_REQUEST_MAX_TTL_MS}.
 * Whether the author is the session's key, and whether the nonce is new, are
 * the peer's checks (`passportPeer#authorizeRequest`).
 */

const crypto = require('crypto');
const Message = require('@fabric/core/types/message');
const { encodeFabricUri, decodeFabricUri } = require('@fabric/core/functions/fabricUri');

/** Contract id the request frames name (sha256 of a fixed label). */
const PASSPORT_REQUEST_CONTRACT = crypto.createHash('sha256').update('@fabric/http:PassportRequest:1', 'utf8').digest('hex');
/** Payload `type`. */
const PASSPORT_REQUEST_TYPE = 'PassportRequest';
const PASSPORT_REQUEST_VERSION = 1;
/** Default life of a request authorization: long enough to send it. */
const PASSPORT_REQUEST_TTL_MS = 60 * 1000;
/** Longest life a request authorization may have. */
const PASSPORT_REQUEST_MAX_TTL_MS = 3 * 60 * 1000;
/** Clock difference tolerated between client and peer. */
const PASSPORT_REQUEST_CLOCK_SKEW_MS = 30 * 1000;
/** Longest path and query a request authorization may name. */
const PASSPORT_MAX_TARGET_LENGTH = 4096;
/** Largest payload JSON. */
const MAX_PAYLOAD_CHARS = 8192;

/** @private */
const HEX32 = /^[0-9a-f]{64}$/;
/** @private */
const PUBKEY = /^0[23][0-9a-f]{64}$/;

/** @private */
function isHash (value) {
  return HEX32.test(value) && !/^0+$/.test(value);
}

/** @private */
function sameString (a, b) {
  const digest = (value) => crypto.createHash('sha256').update(String(value)).digest();
  return crypto.timingSafeEqual(digest(a), digest(b));
}

/**
 * sha256 of an HTTP body, hex (the empty body when there is none).
 * @param {Buffer|Uint8Array|string|null|undefined} body
 * @returns {string}
 */
function requestBodyHash (body) {
  const bytes = body == null ? Buffer.alloc(0) : (typeof body === 'string' ? Buffer.from(body, 'utf8') : Buffer.from(body));
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

/**
 * A request target as signed: path and query, starting with one `/`, no
 * fragment or whitespace. Null otherwise.
 * @param {*} value
 * @returns {string|null}
 */
function normalizeTarget (value) {
  const text = String(value == null ? '' : value);
  if (!text.startsWith('/') || text.startsWith('//') || text.length > PASSPORT_MAX_TARGET_LENGTH || /[\s#]/.test(text)) return null;
  return text;
}

/**
 * Authorize one HTTP request as a peer session. Send the result as `X-Fabric-Request`.
 * @param {Object} params
 * @param {string} params.sessionId
 * @param {string} params.peer The peer's compressed pubkey.
 * @param {string} params.method
 * @param {string} params.target Path and query, e.g. `/services/members/session?x=1`.
 * @param {string} [params.bodyHash] sha256 hex of the body (default: of `params.body`).
 * @param {Buffer|string} [params.body]
 * @param {number} [params.ttlMs] Default {@link PASSPORT_REQUEST_TTL_MS}.
 * @param {number} [params.now]
 * @param {object} sessionKey The session's private Key.
 * @returns {{ message: Message, uri: string, nonce: string, expiresAt: number }}
 */
function createPeerRequest (params = {}, sessionKey) {
  if (!sessionKey || !sessionKey.private || typeof sessionKey.signSchnorrHash !== 'function') {
    throw new TypeError('createPeerRequest: the session\'s private key is required');
  }
  const sessionId = String(params.sessionId || '').toLowerCase();
  if (!isHash(sessionId)) throw new TypeError('createPeerRequest: sessionId required');
  const peer = String(params.peer || '').toLowerCase();
  if (!PUBKEY.test(peer)) throw new TypeError('createPeerRequest: peer must be a compressed pubkey');
  const method = String(params.method || '').toUpperCase();
  if (!/^[A-Z]{1,16}$/.test(method)) throw new TypeError('createPeerRequest: method required');
  const target = normalizeTarget(params.target);
  if (!target) throw new TypeError('createPeerRequest: target must be a path (and query)');
  const bodyHash = params.bodyHash != null ? String(params.bodyHash).toLowerCase() : requestBodyHash(params.body);
  if (!HEX32.test(bodyHash)) throw new TypeError('createPeerRequest: bodyHash must be sha256 hex');
  const issuedAt = Number.isFinite(params.now) ? params.now : Date.now();
  const ttl = Number(params.ttlMs) > 0 ? Math.min(Math.floor(Number(params.ttlMs)), PASSPORT_REQUEST_MAX_TTL_MS) : PASSPORT_REQUEST_TTL_MS;
  const nonce = crypto.randomBytes(32).toString('hex');
  const payload = JSON.stringify({
    type: PASSPORT_REQUEST_TYPE,
    v: PASSPORT_REQUEST_VERSION,
    method,
    target,
    bodyHash,
    nonce,
    issuedAt,
    expiresAt: issuedAt + ttl
  });
  const message = Message.fromFields('CONTRACT_MESSAGE', {
    contract: PASSPORT_REQUEST_CONTRACT,
    payload,
    recipient: peer,
    ref: sessionId
  });
  message.signWithKey(sessionKey);
  return { message, uri: encodeFabricUri(message), nonce, expiresAt: issuedAt + ttl };
}

/**
 * Read an `X-Fabric-Request` against the request it came with.
 * @param {string} input `fabric:` frame
 * @param {Object} expected
 * @param {string} expected.peer This peer's compressed pubkey.
 * @param {string} expected.method
 * @param {string} expected.target Path and query as received.
 * @param {Buffer|string} [expected.body] Body bytes as received.
 * @param {number} [expected.now]
 * @returns {{ ok: true, sessionId: string, nonce: string, author: string, expiresAt: number }|{ ok: false, error: string }}
 */
function readPeerRequest (input, expected = {}) {
  const peer = String(expected.peer || '').toLowerCase();
  if (!PUBKEY.test(peer)) return { ok: false, error: 'expected peer must be a compressed pubkey' };
  const decoded = decodeFabricUri(typeof input === 'string' ? input.trim() : input, { allowedTypes: ['CONTRACT_MESSAGE'] });
  if (!decoded.ok) return decoded;
  const fields = decoded.message.toFields() || {};
  if (fields.contract !== PASSPORT_REQUEST_CONTRACT) return { ok: false, error: 'not a Passport request authorization' };
  if (String(fields.recipient || '').toLowerCase() !== peer) return { ok: false, error: 'request is for another peer' };
  const sessionId = String(fields.ref || '').toLowerCase();
  if (!isHash(sessionId)) return { ok: false, error: 'missing sessionId' };
  if (typeof fields.payload !== 'string' || fields.payload.length > MAX_PAYLOAD_CHARS) return { ok: false, error: 'malformed request authorization' };
  let body;
  try {
    body = JSON.parse(fields.payload);
  } catch (_) {
    return { ok: false, error: 'malformed request authorization' };
  }
  if (!body || body.type !== PASSPORT_REQUEST_TYPE || Number(body.v) !== PASSPORT_REQUEST_VERSION) {
    return { ok: false, error: 'not a Passport request authorization' };
  }
  if (String(body.method || '') !== String(expected.method || '').toUpperCase()) return { ok: false, error: 'method mismatch' };
  if (!normalizeTarget(body.target) || body.target !== String(expected.target || '')) return { ok: false, error: 'target mismatch' };
  if (typeof body.bodyHash !== 'string' || !sameString(body.bodyHash.toLowerCase(), requestBodyHash(expected.body))) {
    return { ok: false, error: 'body mismatch' };
  }
  const now = Number.isFinite(expected.now) ? expected.now : Date.now();
  const issuedAt = Number(body.issuedAt);
  const expiresAt = Number(body.expiresAt);
  if (!Number.isSafeInteger(issuedAt) || !Number.isSafeInteger(expiresAt) || expiresAt <= issuedAt) return { ok: false, error: 'request lifetime invalid' };
  if (expiresAt - issuedAt > PASSPORT_REQUEST_MAX_TTL_MS) return { ok: false, error: 'request lifetime too long' };
  if (expiresAt <= now - PASSPORT_REQUEST_CLOCK_SKEW_MS) return { ok: false, error: 'request expired' };
  if (issuedAt > now + PASSPORT_REQUEST_CLOCK_SKEW_MS) return { ok: false, error: 'request issued in the future' };
  const nonce = String(body.nonce || '').toLowerCase();
  if (!isHash(nonce)) return { ok: false, error: 'missing nonce' };
  return { ok: true, sessionId, nonce, author: decoded.author, expiresAt };
}

module.exports = {
  PASSPORT_REQUEST_CONTRACT,
  PASSPORT_REQUEST_TYPE,
  PASSPORT_REQUEST_TTL_MS,
  PASSPORT_REQUEST_MAX_TTL_MS,
  PASSPORT_REQUEST_CLOCK_SKEW_MS,
  requestBodyHash,
  normalizeTarget,
  createPeerRequest,
  readPeerRequest
};
