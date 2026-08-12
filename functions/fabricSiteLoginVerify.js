'use strict';

/**
 * Verify client-signed Fabric site-login completions (D-011).
 * Same challenge format as Hub `fabric:hub-login:1` so Passport and
 * desktop peers stay interchangeable against LiveRelay on relay.goon.vc.
 */

const {
  buildFabricIdentitySignedPayload,
  fabricIdentityIdFromPubkeyHex,
  verifyIdentitySchnorr
} = require('./fabricIdentitySchnorr');

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
  buildLoginMessage,
  parseDesktopLoginMessage,
  verifyFabricDesktopLoginSignedPayload,
  buildFabricIdentitySignedPayload,
  originsMatchForDesktopSession,
  isLoopbackHostname,
  requestHasProxyForwardHeaders,
  isLocalRequest,
  fabricIdentityIdFromPubkeyHex,
  verifyIdentitySchnorr
};
