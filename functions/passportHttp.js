'use strict';

/**
 * @fileoverview Passport v2 sign-in routes over a
 * {@link module:functions/passportRelyingParty} relying party.
 *
 * - `POST /sessions/challenges { request?, purpose?, origin? }` — a challenge
 *   for the request's pinned origin. Browsers get the binding secret as the
 *   HttpOnly `fabric.passport` cookie; a native client (`X-Fabric-Native: 1`,
 *   no `Origin`) gets it in the body as `binding`.
 * - `POST /sessions { assertion }` — redeem with that binding (cookie, or the
 *   native `X-Fabric-Binding` header). Sets the HttpOnly `fabric.session`
 *   cookie; a native client gets `token` instead. A v1 client (no assertion,
 *   or another frame type) gets 426 `passport_outdated`.
 * - `GET /sessions/current`, `DELETE /sessions/current` — read / end the
 *   session (cookie or `Authorization: Bearer`).
 * - `POST /sessions/self` — only with `selfSign`: a direct loopback request
 *   from the host's own loopback page signs in as the host's own identity.
 *
 * Handlers use only `statusCode`, `setHeader`, and `end`, so they run under
 * Express or a bare `http` server.
 */

const passport = require('@fabric/core/functions/passport');
const { decodeFabricUri } = require('@fabric/core/functions/fabricUri');
const {
  isLocalRequest,
  requestHasProxyForwardHeaders,
  fabricUriFromBody
} = require('./httpRequestTrust');

const SESSION_COOKIE = 'fabric.session';
const BINDING_COOKIE = 'fabric.passport';
const NATIVE_HEADER = 'x-fabric-native';
const BINDING_HEADER = 'x-fabric-binding';
const MAX_BODY_BYTES = 64 * 1024;

/** Answer (426) to a Passport, Hub, or GoonCitizen build from before v2. */
const PASSPORT_OUTDATED = Object.freeze({
  error: 'passport_outdated',
  message: 'This sign-in needs Passport v2. Update Fabric Passport, or your Hub or GoonCitizen desktop app, and try again.'
});

/**
 * Whether a request came from a Passport older than v2: no frame at all, a
 * well-formed Fabric frame of another type (v1 site-login and sign-request
 * frames), or `expectedType` at an older version. Malformed input is not
 * "outdated"; it gets the usual error.
 * @param {*} input `fabric:` string from the request
 * @param {string} expectedType `PASSPORT_ASSERTION`
 * @returns {boolean}
 */
function passportOutdated (input, expectedType) {
  if (typeof input !== 'string' || !input.trim()) return true;
  const decoded = decodeFabricUri(input.trim(), { allowUnsigned: true, allowUnknownTypes: true });
  if (!decoded.ok) return false;
  if (decoded.type !== expectedType) return true;
  let fields = null;
  try { fields = decoded.message.toFields(); } catch (_) {}
  return !!fields && Number(fields.v) < passport.PASSPORT_VERSION;
}

/**
 * @param {import('http').IncomingMessage} req
 * @returns {Object<string, string>}
 */
function parseCookies (req) {
  const out = {};
  const header = req && req.headers && req.headers.cookie;
  if (typeof header !== 'string') return out;
  for (const part of header.split(';')) {
    const at = part.indexOf('=');
    if (at < 1) continue;
    const name = part.slice(0, at).trim();
    if (!name || Object.prototype.hasOwnProperty.call(out, name)) continue;
    try {
      out[name] = decodeURIComponent(part.slice(at + 1).trim());
    } catch (_) {
      out[name] = part.slice(at + 1).trim();
    }
  }
  return out;
}

/**
 * A native (non-browser) client: says so and sends no `Origin`. Browsers
 * always send `Origin` on POST and DELETE, and pages can't remove it.
 * @param {import('http').IncomingMessage} req
 * @returns {boolean}
 */
function isNativeRequest (req) {
  const h = (req && req.headers) || {};
  return String(h[NATIVE_HEADER] || '').trim() === '1' && !h.origin;
}

/**
 * @param {import('http').IncomingMessage} req
 * @returns {string|null}
 */
function bearerToken (req) {
  const auth = req && req.headers && req.headers.authorization;
  if (typeof auth !== 'string') return null;
  const m = /^Bearer\s+([0-9a-f]{64})$/i.exec(auth.trim());
  return m ? m[1].toLowerCase() : null;
}

/** @private */
function cookie (name, value, { secure, maxAgeSeconds }) {
  const parts = [`${name}=${encodeURIComponent(value)}`, 'Path=/', 'HttpOnly', 'SameSite=Strict'];
  if (secure) parts.push('Secure');
  if (maxAgeSeconds != null) parts.push(`Max-Age=${Math.max(0, Math.floor(maxAgeSeconds))}`);
  return parts.join('; ');
}

/** @private */
function bindingCookie (value, { secure, maxAgeSeconds }) {
  const parts = [`${BINDING_COOKIE}=${encodeURIComponent(value)}`, 'Path=/sessions', 'HttpOnly', 'SameSite=Strict'];
  if (secure) parts.push('Secure');
  if (maxAgeSeconds != null) parts.push(`Max-Age=${Math.max(0, Math.floor(maxAgeSeconds))}`);
  return parts.join('; ');
}

/** @private */
function appendSetCookie (res, value) {
  const prior = typeof res.getHeader === 'function' ? res.getHeader('Set-Cookie') : null;
  const list = prior ? (Array.isArray(prior) ? prior.slice() : [String(prior)]) : [];
  list.push(value);
  res.setHeader('Set-Cookie', list);
}

/** @private */
function send (res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

/**
 * `req.body` when a parser already ran, else the raw stream (JSON or text).
 * @param {import('http').IncomingMessage} req
 * @returns {Promise<*>}
 */
async function readBody (req) {
  const parsed = req.body;
  const empty = parsed == null || (typeof parsed === 'object' && !Buffer.isBuffer(parsed) && !Object.keys(parsed).length);
  if (!empty) return parsed;
  if (!req.readable || req.readableEnded) return parsed || {};
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) {
      const err = new Error('body too large');
      err.status = 413;
      throw err;
    }
    chunks.push(chunk);
  }
  const text = Buffer.concat(chunks).toString('utf8').trim();
  if (!text) return {};
  if (text[0] === '{') {
    try {
      return JSON.parse(text);
    } catch (_) {
      const err = new Error('invalid JSON');
      err.status = 400;
      throw err;
    }
  }
  return text;
}

/** @private */
function secureFor (origin) {
  return typeof origin === 'string' && origin.startsWith('https:');
}

/** @private */
function requestedDisclosures (body) {
  if (!body || typeof body !== 'object') return [];
  const raw = body.request;
  if (raw == null || raw === '') return [];
  return Array.isArray(raw) ? raw : String(raw).split(',');
}

/**
 * Build the Passport routes.
 * @param {Object} settings
 * @param {object} settings.relyingParty From `createPassportRelyingParty`.
 * @param {function(object, import('http').IncomingMessage): Promise<(object|void)>} [settings.onSession]
 *   Called with a verified assertion before the session starts. Return extra
 *   session fields, or throw (`err.status`) to refuse.
 * @param {function(object, object): object} [settings.view] Session JSON (default `relyingParty.sessionView`).
 * @param {function({ challenge: string, origin: string, request: string[] }): Promise<string>} [settings.selfSign]
 *   Host-signed assertion for `POST /sessions/self`.
 * @param {string[]} [settings.selfOrigins] Loopback origins allowed to call `/sessions/self`.
 * @returns {{ routes: Array<{ method: string, path: string, handler: Function }>, mount: function(object): void, readRequestSession: function(import('http').IncomingMessage): Promise<(object|null)>, sessionToken: function(import('http').IncomingMessage): (string|null) }}
 */
function createPassportHttp (settings = {}) {
  const rp = settings.relyingParty;
  if (!rp || typeof rp.issueChallenge !== 'function') throw new TypeError('relyingParty required');
  const view = typeof settings.view === 'function' ? settings.view : (session) => rp.sessionView(session);
  const selfOrigins = (settings.selfOrigins || []).map((o) => passport.normalizeOrigin(o)).filter(Boolean);

  function sessionToken (req) {
    return bearerToken(req) || parseCookies(req)[SESSION_COOKIE] || null;
  }

  async function readRequestSession (req) {
    const token = sessionToken(req);
    return token ? rp.readSession(token) : null;
  }

  /**
   * Origin to issue for: the browser's `Origin` (must be pinned), else the
   * native client's `origin` field, else the only pinned origin.
   * @private
   */
  function challengeOrigin (req, body) {
    const header = req.headers && req.headers.origin;
    if (header) return rp.resolveOrigin(header);
    const asked = body && typeof body === 'object' && typeof body.origin === 'string' ? body.origin : undefined;
    return rp.resolveOrigin(asked);
  }

  async function finish (req, res, verified, native) {
    let extra = {};
    if (typeof settings.onSession === 'function') {
      try {
        extra = (await settings.onSession(verified, req)) || {};
      } catch (err) {
        return send(res, err.status || 403, { error: err.message || 'sign-in refused' });
      }
    }
    const { token, session } = await rp.issueSession(verified, extra);
    const body = { session: view(session, verified) };
    if (native) {
      body.token = token;
    } else {
      const maxAgeSeconds = (session.expiresAt - session.issuedAt) / 1000;
      appendSetCookie(res, cookie(SESSION_COOKIE, token, { secure: secureFor(session.origin), maxAgeSeconds }));
    }
    return send(res, 200, body);
  }

  async function createChallenge (req, res) {
    try {
      const body = await readBody(req);
      const origin = challengeOrigin(req, body);
      if (!origin) return send(res, 403, { error: 'origin is not pinned for this service' });
      const native = isNativeRequest(req);
      const issued = await rp.issueChallenge({
        origin,
        request: requestedDisclosures(body),
        purpose: body && typeof body === 'object' && typeof body.purpose === 'string' ? body.purpose : undefined
      });
      const out = {
        challenge: issued.challenge,
        expiresAt: issued.expiresAt,
        origin: issued.origin,
        network: issued.network,
        request: issued.request
      };
      if (native) {
        out.binding = issued.bindingSecret;
      } else {
        const maxAgeSeconds = (issued.expiresAt - Date.now()) / 1000 + 30;
        appendSetCookie(res, bindingCookie(issued.bindingSecret, { secure: secureFor(origin), maxAgeSeconds }));
      }
      return send(res, 200, out);
    } catch (err) {
      return send(res, err.status || 400, { error: err.message || 'challenge failed' });
    }
  }

  async function createSession (req, res) {
    try {
      const body = await readBody(req);
      const assertion = body && typeof body === 'object' && typeof body.assertion === 'string'
        ? body.assertion
        : fabricUriFromBody(body);
      if (passportOutdated(assertion, 'PASSPORT_ASSERTION')) return send(res, 426, PASSPORT_OUTDATED);
      const native = isNativeRequest(req);
      const binding = native
        ? String((req.headers && req.headers[BINDING_HEADER]) || '').trim()
        : parseCookies(req)[BINDING_COOKIE];
      if (!native) appendSetCookie(res, bindingCookie('', { secure: secureFor(req.headers && req.headers.origin), maxAgeSeconds: 0 }));
      const verified = await rp.redeem(binding, assertion);
      if (!verified.ok) return send(res, verified.status || 400, { error: verified.error });
      const header = req.headers && req.headers.origin;
      if (header && passport.normalizeOrigin(header) !== verified.origin) {
        return send(res, 403, { error: 'origin mismatch' });
      }
      return finish(req, res, verified, native);
    } catch (err) {
      return send(res, err.status || 400, { error: err.message || 'sign-in failed' });
    }
  }

  async function currentSession (req, res) {
    const session = await readRequestSession(req);
    if (!session) return send(res, 401, { error: 'not signed in' });
    return send(res, 200, { session: view(session) });
  }

  async function endSession (req, res) {
    const token = sessionToken(req);
    if (token) await rp.revokeSession(token);
    appendSetCookie(res, cookie(SESSION_COOKIE, '', { secure: secureFor(req.headers && req.headers.origin), maxAgeSeconds: 0 }));
    return send(res, 200, { ok: true });
  }

  async function selfSession (req, res) {
    if (typeof settings.selfSign !== 'function') return send(res, 404, { error: 'not found' });
    if (!isLocalRequest(req) || requestHasProxyForwardHeaders(req)) {
      return send(res, 403, { error: 'loopback only' });
    }
    const origin = passport.normalizeOrigin((req.headers && req.headers.origin) || '');
    if (!origin || !selfOrigins.includes(origin)) return send(res, 403, { error: 'origin not allowed' });
    try {
      const body = await readBody(req);
      const issued = await rp.issueChallenge({ origin, request: requestedDisclosures(body) });
      const assertion = await settings.selfSign({ challenge: issued.challenge, origin, request: issued.request });
      const verified = await rp.redeem(issued.bindingSecret, assertion);
      if (!verified.ok) return send(res, verified.status || 400, { error: verified.error });
      return finish(req, res, verified, false);
    } catch (err) {
      return send(res, err.status || 500, { error: err.message || 'self sign-in failed' });
    }
  }

  const routes = [
    { method: 'POST', path: '/sessions/challenges', handler: createChallenge },
    { method: 'POST', path: '/sessions/self', handler: selfSession },
    { method: 'POST', path: '/sessions', handler: createSession },
    { method: 'GET', path: '/sessions/current', handler: currentSession },
    { method: 'DELETE', path: '/sessions/current', handler: endSession }
  ];

  /**
   * Mount on a `@fabric/http` HTTPServer (`_addRoute`) or an Express app.
   * @param {object} server
   */
  function mount (server) {
    for (const route of routes) {
      if (server && typeof server._addRoute === 'function') {
        server._addRoute(route.method, route.path, route.handler);
      } else if (server && typeof server[route.method.toLowerCase()] === 'function') {
        server[route.method.toLowerCase()](route.path, route.handler);
      } else {
        throw new TypeError('server must have _addRoute or Express verbs');
      }
    }
  }

  return { routes, mount, readRequestSession, sessionToken };
}

module.exports = {
  SESSION_COOKIE,
  BINDING_COOKIE,
  NATIVE_HEADER,
  BINDING_HEADER,
  PASSPORT_OUTDATED,
  passportOutdated,
  parseCookies,
  isNativeRequest,
  bearerToken,
  readBody,
  createPassportHttp
};
