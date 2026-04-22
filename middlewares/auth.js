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

  const hashHex = crypto
    .createHash('sha256')
    .update(`${encodedHeader}.${encodedPayload}.${secret}`)
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
 * Build a bearer string accepted by {@link verifyBearerToken}, using @fabric/core `Token` encodings and SHA-256.
 *
 * @param {string} secret Same as `this.settings.tokenSecret` or `this.settings.seed` on the server.
 * @param {Object} [payload={}] Decoded token payload; JSON-serializable.
 * @returns {string} `header.payload.signature` (base64url segments)
 */
function buildBearerToken (secret, payload = {}) {
  if (secret == null || typeof secret !== 'string' || !secret) {
    throw new Error('buildBearerToken: secret string required');
  }
  if (payload != null && typeof payload !== 'object') {
    throw new Error('buildBearerToken: payload must be a plain object');
  }
  const p = /** @type {Record<string, unknown>} */ (payload && typeof payload === 'object' ? payload : {});
  const header = { alg: 'SHA256', typ: 'FABRIC_TOKEN' };
  const encodedHeader = Token.base64UrlEncode(JSON.stringify(header));
  const encodedPayload = Token.base64UrlEncode(JSON.stringify(p));
  const hashHex = crypto
    .createHash('sha256')
    .update(`${encodedHeader}.${encodedPayload}.${secret}`)
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
