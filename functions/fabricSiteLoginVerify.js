'use strict';

/**
 * Verify client-signed Fabric site-login completions.
 * Same challenge format as `fabric:hub-login:1` so wallet extensions and
 * desktop peers stay interchangeable between hubs and standalone relays.
 */

const crypto = require('crypto');
const {
  buildFabricIdentitySignedPayload,
  fabricIdentityIdFromPubkeyHex,
  resolveFabricSigningIdentity,
  verifyIdentitySchnorr
} = require('./fabricIdentitySchnorr');

/** Create-response header for signed-session redeem / device-link cancel. Not in QR. */
const FABRIC_POLL_HEADER = 'x-fabric-poll-secret';

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
 * Poll secret from `X-Fabric-Poll-Secret` (or `X-Poll-Secret`) only.
 * Query strings, `fabric://`, and QR stay sessionId-only so the secret
 * cannot leak via logs, Referer, or a copied URL.
 * @param {import('http').IncomingMessage} [req]
 * @returns {string}
 */
function pollSecretFromRequest (req) {
  const h = req && req.headers;
  if (h && typeof h === 'object') {
    const header = h[FABRIC_POLL_HEADER] || h['x-poll-secret'];
    if (typeof header === 'string' && header.trim()) return header.trim();
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
  if (typeof payload.fabric === 'string' && payload.fabric) {
    return verifyFabricDesktopLoginResponse(payload, expected);
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

/**
 * Core `fabric:` site-login helpers, loaded lazily so an older pinned
 * `@fabric/core` still loads this module (the `fabric:` path then reports
 * `available: false`).
 * @private
 * @returns {object|null}
 */
function loadCoreSiteLogin () {
  try {
    return require('@fabric/core/functions/fabricSiteLogin');
  } catch (_) {
    return null;
  }
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

/**
 * Session-poll payload completed with a `fabric:` `SiteLoginResponse`: the
 * session's own `message` names the nonce, session id, and origin the
 * response must be bound to.
 * @private
 * @param {Object} payload `{ fabric, message, identity }` from `GET /sessions/:id`
 * @param {Object} [expected] `{ sessionId, origin }`
 * @returns {{ ok: true, fabric: object }|{ ok: false, error: string }}
 */
function verifyFabricDesktopLoginResponse (payload, expected) {
  const parsed = parseDesktopLoginMessage(payload.message);
  if (!parsed) return { ok: false, error: 'Signed message format is invalid' };
  const exp = expected && typeof expected === 'object' ? expected : {};
  const wantSid = exp.sessionId != null ? String(exp.sessionId).trim() : '';
  const wantOrigin = exp.origin != null ? String(exp.origin).trim() : '';
  if ((wantSid && !wantOrigin) || (!wantSid && wantOrigin)) {
    return { ok: false, error: 'Login session binding is incomplete' };
  }
  if (wantSid && parsed.sessionId.toLowerCase() !== wantSid.toLowerCase()) {
    return { ok: false, error: 'Login session does not match' };
  }
  if (wantOrigin && !originsMatchForDesktopSession(parsed.origin, wantOrigin)) {
    return { ok: false, error: 'Login origin does not match this page' };
  }
  const out = verifyFabricSiteLogin(payload.fabric, { origin: parsed.origin, nonce: parsed.nonce });
  if (!out.ok) return { ok: false, error: out.error || 'fabric: login response invalid' };
  const claimed = payload.identity && payload.identity.id != null ? String(payload.identity.id) : '';
  if (claimed && out.identity && out.identity.id && claimed !== String(out.identity.id)) {
    return { ok: false, error: 'Login identity does not match the signed response' };
  }
  return { ok: true, fabric: out };
}

/**
 * Verify a signed `fabric:` `SiteLoginResponse` for the site that asked.
 * The response must name `origin` and echo `nonce`; the signer key is the
 * frame author.
 * @param {string} uri `fabric:` string
 * @param {Object} expected
 * @param {string} expected.origin Site origin the response must name
 * @param {string} expected.nonce Challenge nonce the response must echo
 * @param {number} [expected.now] Clock override (ms)
 * @param {string[]} [expected.signers] Allowed signer labels
 * @returns {{ ok: true, identity: { id: string, pubkey: string, xpub: (string|null) }, pubkeyHex: string, signer: string, crossSign: (object|null), issuedAt: number, expiresAt: number }|{ ok: false, error: string, available?: boolean }}
 */
function verifyFabricSiteLogin (uri, expected = {}) {
  const core = loadCoreSiteLogin();
  if (!core || typeof core.verifySiteLoginResponse !== 'function') {
    return { ok: false, available: false, error: 'fabric: site login needs a newer @fabric/core' };
  }
  const exp = expected && typeof expected === 'object' ? expected : {};
  if (!exp.origin || !exp.nonce) {
    return { ok: false, error: 'origin and nonce are required to verify a site login' };
  }
  const verified = core.verifySiteLoginResponse(uri, {
    origin: exp.origin,
    nonce: exp.nonce,
    now: exp.now,
    signers: exp.signers
  });
  if (!verified.ok) return { ok: false, error: verified.error || 'invalid site login' };
  return {
    ok: true,
    identity: verified.identity,
    pubkeyHex: verified.identity.pubkey,
    signer: verified.signer,
    crossSign: verified.crossSign,
    issuedAt: verified.issuedAt,
    expiresAt: verified.expiresAt
  };
}

/**
 * Complete a pending `/sessions` record from a `fabric:` `SiteLoginResponse`
 * bound to the session's origin and challenge nonce. Mutates `session` on
 * success; the frame itself is kept as `session.fabric` so pollers can verify
 * it again with {@link verifyFabricSiteLogin}.
 * @param {{ origin: string, nonce: string, status: string }} session
 * @param {string} uri
 * @param {Object} [options]
 * @param {number} [options.now]
 * @returns {{ ok: true, json: object }|{ ok: false, status: number, error: string }}
 */
function completeSessionWithFabricResponse (session, uri, options = {}) {
  const verified = verifyFabricSiteLogin(uri, {
    origin: session && session.origin,
    nonce: session && session.nonce,
    now: options.now
  });
  if (!verified.ok) {
    return { ok: false, status: verified.available === false ? 501 : 400, error: verified.error };
  }
  session.status = 'signed';
  session.signedAt = Date.now();
  session.signer = 'client';
  session.signerLabel = verified.signer;
  session.signature = null;
  session.fabric = String(uri).trim();
  session.pubkeyHex = verified.pubkeyHex;
  session.identity = { id: verified.identity.id, xpub: verified.identity.xpub };
  return {
    ok: true,
    json: {
      ok: true,
      signer: 'client',
      signerLabel: verified.signer,
      pubkeyHex: session.pubkeyHex,
      message: session.message,
      identity: session.identity,
      fabric: session.fabric
    }
  };
}

module.exports = {
  DESKTOP_LOGIN_PREFIX,
  completeSessionWithFabricResponse,
  fabricUriFromBody,
  verifyFabricSiteLogin,
  FABRIC_POLL_HEADER,
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
