'use strict';

/**
 * @fileoverview Who sent an HTTP request: loopback vs proxied traffic, origin
 * matching for poll gates, constant-time token compares, and the
 * `X-Fabric-Poll-Secret` helpers device-link sessions use.
 */

const crypto = require('crypto');

/** Create-response header for device-link redeem / cancel. Never in a QR or URL. */
const FABRIC_POLL_HEADER = 'x-fabric-poll-secret';

/**
 * @param {string} h
 * @returns {boolean}
 */
function isLoopbackHostname (h) {
  if (typeof h !== 'string') return false;
  const x = h.toLowerCase();
  return x === 'localhost' || x === '127.0.0.1' || x === '[::1]' || x === '::1';
}

/**
 * True when the request came through a reverse proxy. Behind Caddy the socket
 * is always 127.0.0.1, so loopback must not short-circuit origin checks then.
 * @param {import('http').IncomingMessage} [req]
 * @returns {boolean}
 */
function requestHasProxyForwardHeaders (req) {
  const h = req && req.headers;
  if (!h || typeof h !== 'object') return false;
  return !!(h['x-forwarded-for'] || h['x-forwarded-host'] || h['x-real-ip'] || h.forwarded);
}

/**
 * Direct loopback client only — not proxied public traffic to a loopback bind.
 * @param {import('http').IncomingMessage} [req]
 * @returns {boolean}
 */
function isLocalRequest (req) {
  if (requestHasProxyForwardHeaders(req)) return false;
  const addr = (req && req.socket && req.socket.remoteAddress) ||
    (req && req.connection && req.connection.remoteAddress) ||
    '';
  return addr === '127.0.0.1' || addr === '::1' || addr === '::ffff:127.0.0.1';
}

/**
 * Same origin, treating any two loopback hostnames on one port as equal.
 * @param {string} clientOriginLike
 * @param {string} sessionOrigin
 * @returns {boolean}
 */
function originsMatch (clientOriginLike, sessionOrigin) {
  if (!clientOriginLike || !sessionOrigin) return false;
  if (clientOriginLike === sessionOrigin) return true;
  let clientUrl;
  let sessionUrl;
  try {
    clientUrl = new URL(clientOriginLike);
    sessionUrl = new URL(sessionOrigin);
  } catch (_) {
    return false;
  }
  if (clientUrl.protocol !== sessionUrl.protocol) return false;
  if (isLoopbackHostname(clientUrl.hostname) && isLoopbackHostname(sessionUrl.hostname)) {
    const cPort = clientUrl.port || (clientUrl.protocol === 'https:' ? '443' : '80');
    const sPort = sessionUrl.port || (sessionUrl.protocol === 'https:' ? '443' : '80');
    return cPort === sPort;
  }
  return clientUrl.host === sessionUrl.host;
}

/** @private */
function refererOriginMatches (referer, sessionOrigin) {
  if (typeof referer !== 'string' || !referer) return false;
  try {
    const u = new URL(referer);
    return originsMatch(`${u.protocol}//${u.host}`, sessionOrigin);
  } catch (_) {
    return false;
  }
}

/**
 * Browser-ish poll gate for a session bound to `sessionOrigin`. Origin and
 * Referer are forgeable by non-browser clients, so this is never a possession
 * proof; redeem and cancel also need {@link requestMayRedeemSessionSecret}.
 * @param {import('http').IncomingMessage} req
 * @param {string} sessionOrigin
 * @returns {boolean}
 */
function clientMayPollSession (req, sessionOrigin) {
  if (isLocalRequest(req)) return true;
  if (!sessionOrigin || typeof sessionOrigin !== 'string') return false;
  try {
    new URL(sessionOrigin); // eslint-disable-line no-new
  } catch (_) {
    return false;
  }
  const hdrOrigin = req.headers && req.headers.origin;
  if (typeof hdrOrigin === 'string' && originsMatch(hdrOrigin, sessionOrigin)) return true;
  return refererOriginMatches(req.headers && req.headers.referer, sessionOrigin);
}

/**
 * Constant-time UTF-8 token compare (rejects empty / length-mismatched inputs).
 * @param {string} a
 * @param {string} b
 * @returns {boolean}
 */
function tokensEqual (a, b) {
  const left = Buffer.from(String(a || ''), 'utf8');
  const right = Buffer.from(String(b || ''), 'utf8');
  if (!left.length || left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

/**
 * Poll secret from `X-Fabric-Poll-Secret` only (never a query string).
 * @param {import('http').IncomingMessage} [req]
 * @returns {string}
 */
function pollSecretFromRequest (req) {
  const h = req && req.headers;
  if (h && typeof h === 'object') {
    const header = h[FABRIC_POLL_HEADER];
    if (typeof header === 'string' && header.trim()) return header.trim();
  }
  return '';
}

/**
 * @param {import('http').IncomingMessage} [req]
 * @param {{ pollSecret?: string }} [session]
 * @returns {boolean}
 */
function requestPresentsSessionPollSecret (req, session) {
  const expected = session && typeof session.pollSecret === 'string' ? session.pollSecret : '';
  if (!expected) return false;
  return tokensEqual(pollSecretFromRequest(req), expected);
}

/**
 * Sensitive redeem / cancel: direct loopback, or the create-response secret.
 * @param {import('http').IncomingMessage} [req]
 * @param {{ pollSecret?: string }} [session]
 * @returns {boolean}
 */
function requestMayRedeemSessionSecret (req, session) {
  if (isLocalRequest(req)) return true;
  return requestPresentsSessionPollSecret(req, session);
}

/**
 * @param {object} [headers]
 * @param {string} [pollSecret]
 * @returns {object}
 */
function applyPollSecretHeader (headers, pollSecret) {
  const h = headers && typeof headers === 'object' ? { ...headers } : {};
  const secret = String(pollSecret || '').trim();
  if (secret) h['X-Fabric-Poll-Secret'] = secret;
  return h;
}

/**
 * `fabric:` string from a request body: the raw text body, or `{ fabric }`.
 * @param {string|object} body
 * @returns {string|null}
 */
function fabricUriFromBody (body) {
  let text = null;
  if (typeof body === 'string') text = body;
  else if (Buffer.isBuffer(body)) text = body.toString('utf8');
  else if (body && typeof body === 'object' && typeof body.fabric === 'string') text = body.fabric;
  if (text == null) return null;
  text = text.trim();
  return /^fabric:/i.test(text) ? text : null;
}

module.exports = {
  FABRIC_POLL_HEADER,
  isLoopbackHostname,
  requestHasProxyForwardHeaders,
  isLocalRequest,
  originsMatch,
  clientMayPollSession,
  tokensEqual,
  pollSecretFromRequest,
  requestPresentsSessionPollSecret,
  requestMayRedeemSessionSecret,
  applyPollSecretHeader,
  fabricUriFromBody
};
