'use strict';

const {
  HTTP_IDENTITY_HEADER_NAME,
  HTTP_SIGNATURE_HEADER_NAME,
  HTTP_IDENTITY_HEADER_NAME_LOWER,
  HTTP_SIGNATURE_HEADER_NAME_LOWER
} = require('../constants');

const crypto = require('crypto');
const Identity = require('@fabric/core/types/identity');
const Token = require('@fabric/core/types/token');
// const Peer = require('@fabric/core/types/peer');

const hasRole = require('../contracts/hasRole');

function safeEqual (left, right) {
  if (!left || !right) return false;
  const leftBuffer = Buffer.from(String(left));
  const rightBuffer = Buffer.from(String(right));
  if (leftBuffer.length !== rightBuffer.length) return false;
  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

/**
 * @param {unknown} value
 * @returns {boolean} True for plain `Object` instances (incl. `Object.create(null)`), not arrays, `Date`, etc.
 */
function isPlainObject (value) {
  if (value === null || typeof value !== 'object') return false;
  if (Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === null || proto === Object.prototype;
}

function verifyBearerToken (token, secret) {
  if (!secret || typeof secret !== 'string') {
    return { valid: false, error: 'missing_secret' };
  }

  if (!token || typeof token !== 'string') {
    return { valid: false, error: 'missing_token' };
  }

  const parts = token.split('.');
  if (parts.length !== 3) {
    return { valid: false, error: 'invalid_format' };
  }

  const [encodedHeader, encodedPayload, signature] = parts;
  let header = null;
  let payload = null;

  try {
    header = JSON.parse(Token.base64UrlDecode(encodedHeader));
  } catch {
    return { valid: false, error: 'invalid_header' };
  }

  try {
    payload = JSON.parse(Token.base64UrlDecode(encodedPayload));
  } catch {
    return { valid: false, error: 'invalid_payload' };
  }

  if (!header || typeof header !== 'object' || header.alg !== 'HMAC-SHA256') {
    return { valid: false, error: 'invalid_header', header, payload, signature };
  }

  const hashHex = crypto
    .createHmac('sha256', secret)
    .update(`${encodedHeader}.${encodedPayload}`)
    .digest('hex');
  const expectedSignature = Token.base64UrlEncode(hashHex);
  const valid = safeEqual(signature, expectedSignature);

  return {
    valid,
    error: valid ? null : 'invalid_signature',
    header,
    payload,
    signature,
    expectedSignature
  };
}

/**
 * Build a bearer string accepted by {@link verifyBearerToken}, using @fabric/core `Token` encodings
 * and HMAC-SHA256 over `headerB64 + '.' + payloadB64` (not a hash of the concatenation with the secret as “salt”).
 *
 * @param {string} secret Same as `this.settings.tokenSecret` or `this.settings.seed` on the server.
 * @param {Object} [payload={}] Decoded token payload; must be a plain object, JSON-serializable.
 * @returns {string} `header.payload.signature` (base64url segments)
 */
function buildBearerToken (secret, payload = {}) {
  if (secret == null || typeof secret !== 'string' || !secret) {
    throw new Error('buildBearerToken: secret string required');
  }
  if (payload == null) {
    throw new Error('buildBearerToken: payload must be a plain object');
  }
  if (!isPlainObject(payload)) {
    throw new Error('buildBearerToken: payload must be a plain object');
  }
  const p = /** @type {Record<string, unknown>} */ (payload);
  const header = { alg: 'HMAC-SHA256', typ: 'FABRIC_TOKEN' };
  const encodedHeader = Token.base64UrlEncode(JSON.stringify(header));
  const encodedPayload = Token.base64UrlEncode(JSON.stringify(p));
  const hashHex = crypto
    .createHmac('sha256', secret)
    .update(`${encodedHeader}.${encodedPayload}`)
    .digest('hex');
  return `${encodedHeader}.${encodedPayload}.${Token.base64UrlEncode(hashHex)}`;
}
// const hasState = require('./hasState');

module.exports = function FabricAuthenticationMiddleware (request, response, next) {
  request.identity = null;
  request.hasRole = hasRole.bind(request);
  // request.hasState = hasState.bind(app.state);
  request.authenticated = false;
  request.tokenHeader = null;
  request.tokenPayload = null;
  request.tokenSignature = null;
  request.tokenError = null;

  if (request.headers[HTTP_IDENTITY_HEADER_NAME_LOWER]) {
    try {
      request.identity = Identity.fromString(request.headers[HTTP_IDENTITY_HEADER_NAME_LOWER]);
    } catch {

    }
  } else {
    if (this.settings.verbosity > 2) this.emit('warning', `[WARNING] No "${HTTP_IDENTITY_HEADER_NAME}" header.  Consider rejecting here.`);
  }

  if (request.token) {
    const secret = this.settings.tokenSecret || this.settings.seed;
    const verification = verifyBearerToken(request.token, secret);
    request.tokenHeader = verification.header;
    request.tokenPayload = verification.payload;
    request.tokenSignature = verification.signature;
    request.tokenError = verification.valid ? null : verification.error;
    request.authenticated = verification.valid;

    if (!verification.valid && this.settings.verbosity > 2) {
      this.emit('warning', `[WARNING] Invalid bearer token: ${verification.error}`);
    }
  }

  return next();
};

module.exports.verifyBearerToken = verifyBearerToken;
module.exports.buildBearerToken = buildBearerToken;
