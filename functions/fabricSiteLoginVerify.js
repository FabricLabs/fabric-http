'use strict';

/**
 * Verify client-signed Fabric site-login completions (D-011).
 * Same challenge format as Hub `fabric:hub-login:1` so Passport and
 * desktop peers stay interchangeable against LiveRelay on relay.goon.vc.
 */

const crypto = require('crypto');
const {
  buildFabricIdentitySignedPayload,
  fabricIdentityIdFromPubkeyHex,
  resolveFabricSigningIdentity,
  verifyIdentitySchnorr
} = require('./fabricIdentitySchnorr');

/** Create-response secret for signed-session redeem / device-link cancel. Not in QR. */
const POLL_SECRET_HEADER = 'x-fabric-poll-secret';

const DESKTOP_LOGIN_PREFIX = 'fabric:hub-login:1';

function isLoopbackHostname (h) {
  if (typeof h !== 'string') return false;
  const x = h.toLowerCase();
  return x === 'localhost' || x === '127.0.0.1' || x === '[::1]' || x === '::1';
}

/**
 * True when the request arrived via a reverse proxy (common when Hub HTTP
 * binds loopback behind Caddy). Peer socket is then always 127.0.0.1 and must
 * not short-circuit Origin / Referer binding for site-login or device-link.
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
  const addr = (req && req.socket && req.socket.remoteAddress)
    || (req && req.connection && req.connection.remoteAddress)
    || '';
  return addr === '127.0.0.1' || addr === '::1' || addr === '::ffff:127.0.0.1';
}

function originsMatchForDesktopSession (clientOriginLike, sessionOrigin) {
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
  const cLoop = isLoopbackHostname(clientUrl.hostname);
  const sLoop = isLoopbackHostname(sessionUrl.hostname);
  if (cLoop && sLoop) {
    const cPort = clientUrl.port || (clientUrl.protocol === 'https:' ? '443' : '80');
    const sPort = sessionUrl.port || (sessionUrl.protocol === 'https:' ? '443' : '80');
    return cPort === sPort;
  }
  return clientUrl.host === sessionUrl.host;
}

function refererOriginMatchesSession (referer, sessionOrigin) {
  if (typeof referer !== 'string' || !referer) return false;
  try {
    const u = new URL(referer);
    return originsMatchForDesktopSession(`${u.protocol}//${u.host}`, sessionOrigin);
  } catch (_) {
    return false;
  }
}

function hostHeaderMatchesSessionOrigin (requestHost, sessionOrigin) {
  if (!requestHost || !sessionOrigin) return false;
  try {
    const sessionUrl = new URL(sessionOrigin);
    if (requestHost === sessionUrl.host) return true;
    const pseudo = `${sessionUrl.protocol}//${requestHost}`;
    return originsMatchForDesktopSession(pseudo, sessionOrigin);
  } catch (_) {
    return false;
  }
}

/**
 * Browser-ish poll gate for pending `GET /sessions/:id` and device-link GET.
 * Matching Origin / Referer / Sec-Fetch-Site is **not** a possession proof —
 * non-browser clients can forge those headers. Signed-session redeem and
 * device-link cancel additionally require `requestMayRedeemSessionSecret`
 * (`X-Fabric-Poll-Secret` from the create JSON — never from QR).
 * @param {import('http').IncomingMessage} req
 * @param {string} sessionOrigin
 * @returns {boolean}
 */
function clientMayPollDesktopSession (req, sessionOrigin) {
  if (isLocalRequest(req)) return true;
  if (!sessionOrigin || typeof sessionOrigin !== 'string') return false;
  try {
    // eslint-disable-next-line no-new
    new URL(sessionOrigin);
  } catch (_) {
    return false;
  }
  const hdrOrigin = req.headers && req.headers.origin;
  if (typeof hdrOrigin === 'string' && originsMatchForDesktopSession(hdrOrigin, sessionOrigin)) return true;
  const ref = req.headers && req.headers.referer;
  if (refererOriginMatchesSession(ref, sessionOrigin)) return true;
  const sfs = req.headers && String(req.headers['sec-fetch-site'] || '').toLowerCase();
  if (sfs === 'same-origin' || sfs === 'same-site') {
    const host = req.headers && req.headers.host;
    if (host && hostHeaderMatchesSessionOrigin(host, sessionOrigin)) return true;
  }
  return false;
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
 * Poll secret from `X-Fabric-Poll-Secret` (or `X-Poll-Secret`) or `?pollSecret=`.
 * Never read from `fabric://` / QR — those carry only `sessionId`.
 * @param {import('http').IncomingMessage} [req]
 * @returns {string}
 */
function pollSecretFromRequest (req) {
  const h = req && req.headers;
  if (h && typeof h === 'object') {
    const header = h[POLL_SECRET_HEADER] || h['x-poll-secret'];
    if (typeof header === 'string' && header.trim()) return header.trim();
  }
  if (req && req.query && typeof req.query.pollSecret === 'string') {
    const q = String(req.query.pollSecret).trim();
    if (q) return q;
  }
  if (req && typeof req.url === 'string') {
    try {
      const u = new URL(req.url, 'http://127.0.0.1');
      const q = u.searchParams.get('pollSecret');
      if (q && String(q).trim()) return String(q).trim();
    } catch (_) { /* ignore */ }
  }
  return '';
}

/**
 * True when the request presents the create-response `pollSecret`.
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
 * Sensitive redeem (signed login token, device-link cancel) for non-loopback
 * clients. Direct loopback still skips the secret so local desktop/dev works.
 * Matching Origin is **not** enough — those headers are forgeable.
 * @param {import('http').IncomingMessage} [req]
 * @param {{ pollSecret?: string }} [session]
 * @returns {boolean}
 */
function requestMayRedeemSessionSecret (req, session) {
  if (isLocalRequest(req)) return true;
  return requestPresentsSessionPollSecret(req, session);
}

/**
 * Attach `X-Fabric-Poll-Secret` when the create response stored a secret.
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

function parseDesktopLoginMessage (msg) {
  const prefix = `${DESKTOP_LOGIN_PREFIX}:`;
  const s = String(msg || '');
  if (!s.startsWith(prefix)) return null;
  const rest = s.slice(prefix.length);
  const nonce = rest.slice(0, 64);
  if (!/^[a-f0-9]{64}$/i.test(nonce) || rest[64] !== ':') return null;
  const afterNonce = rest.slice(65);
  const sessionId = afterNonce.slice(0, 48);
  if (!/^[a-f0-9]{48}$/i.test(sessionId) || afterNonce[48] !== ':') return null;
  const origin = afterNonce.slice(49);
  if (!origin) return null;
  return { nonce, sessionId, origin };
}

function buildLoginMessage (sessionId, origin, nonce) {
  return `${DESKTOP_LOGIN_PREFIX}:${nonce}:${sessionId}:${origin}`;
}

/**
 * @param {object} payload
 * @param {{ sessionId: string, origin: string }} expected
 * @returns {{ ok: true }|{ ok: false, error: string }}
 */
function verifyFabricDesktopLoginSignedPayload (payload, expected) {
  if (!payload || typeof payload !== 'object') {
    return { ok: false, error: 'Invalid login payload' };
  }
  const verified = verifyIdentitySchnorr(
    payload.message,
    payload.signature,
    payload.pubkeyHex,
    payload.identity
  );
  if (!verified.ok) return verified;

  const exp = expected && typeof expected === 'object' ? expected : {};
  const wantSid = exp.sessionId != null ? String(exp.sessionId).trim() : '';
  const wantOrigin = exp.origin != null ? String(exp.origin).trim() : '';
  // Fail closed on a half-populated binding: signature-only is only for unbound callers.
  if ((wantSid && !wantOrigin) || (!wantSid && wantOrigin)) {
    return { ok: false, error: 'Login session binding is incomplete' };
  }
  if (wantSid && wantOrigin) {
    const parsed = parseDesktopLoginMessage(payload.message);
    if (!parsed) {
      return { ok: false, error: 'Signed message format is invalid' };
    }
    if (parsed.sessionId.toLowerCase() !== wantSid.toLowerCase()) {
      return { ok: false, error: 'Login session does not match' };
    }
    if (!originsMatchForDesktopSession(parsed.origin, wantOrigin)) {
      return { ok: false, error: 'Login origin does not match this page' };
    }
  }

  return { ok: true };
}

module.exports = {
  DESKTOP_LOGIN_PREFIX,
  POLL_SECRET_HEADER,
  buildLoginMessage,
  parseDesktopLoginMessage,
  verifyFabricDesktopLoginSignedPayload,
  buildFabricIdentitySignedPayload,
  originsMatchForDesktopSession,
  refererOriginMatchesSession,
  hostHeaderMatchesSessionOrigin,
  clientMayPollDesktopSession,
  tokensEqual,
  pollSecretFromRequest,
  requestPresentsSessionPollSecret,
  requestMayRedeemSessionSecret,
  applyPollSecretHeader,
  isLoopbackHostname,
  requestHasProxyForwardHeaders,
  isLocalRequest,
  fabricIdentityIdFromPubkeyHex,
  resolveFabricSigningIdentity,
  verifyIdentitySchnorr
};
