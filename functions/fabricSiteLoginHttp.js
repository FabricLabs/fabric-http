'use strict';

const crypto = require('crypto');
const {
  DESKTOP_LOGIN_PREFIX,
  buildLoginMessage,
  completeSessionWithFabricResponse,
  fabricUriFromBody,
  originsMatchForDesktopSession,
  isLocalRequest,
  clientMayPollDesktopSession,
  tokensEqual,
  requestMayRedeemSessionSecret
} = require('./fabricSiteLoginVerify');
const SESSION_TTL_MS = 10 * 60 * 1000;
const MAX_SESSIONS = 256;

function randomSessionId () {
  return crypto.randomBytes(24).toString('hex');
}

function randomNonce () {
  return crypto.randomBytes(32).toString('hex');
}

function pruneSessions (hub) {
  if (!hub._desktopAuthSessions) return;
  const now = Date.now();
  for (const [id, s] of hub._desktopAuthSessions) {
    if (!s || now - s.createdAt > SESSION_TTL_MS) hub._desktopAuthSessions.delete(id);
  }
  while (hub._desktopAuthSessions.size > MAX_SESSIONS) {
    const first = hub._desktopAuthSessions.keys().next().value;
    hub._desktopAuthSessions.delete(first);
  }
}

function sendJson (res, status, obj) {
  res.setHeader('Content-Type', 'application/json');
  res.status(status).send(JSON.stringify(obj));
}

function getBearerToken (req) {
  const auth = req.headers && req.headers.authorization;
  if (auth && typeof auth === 'string' && auth.startsWith('Bearer ')) {
    return auth.slice(7).trim();
  }
  return '';
}

function pruneDelegationRegistry (hub) {
  if (!hub._delegationRegistry) return;
  const now = Date.now();
  for (const [id, row] of hub._delegationRegistry) {
    if (!row || now - (row.linkedAt || 0) > SESSION_TTL_MS) {
      hub._delegationRegistry.delete(id);
    }
  }
  while (hub._delegationRegistry.size > MAX_SESSIONS) {
    const first = hub._delegationRegistry.keys().next().value;
    hub._delegationRegistry.delete(first);
  }
}

function handleSessionCreate (hub, req, res) {
  try {
    pruneSessions(hub);
    const body = (req && req.body && typeof req.body === 'object') ? req.body : {};
    let origin = typeof body.origin === 'string' ? body.origin.trim() : '';
    if (!origin) {
      const ref = req.headers && req.headers.referer;
      if (typeof ref === 'string' && ref) {
        try {
          const u = new URL(ref);
          origin = `${u.protocol}//${u.host}`;
        } catch (e) {}
      }
    }
    if (!origin) {
      sendJson(res, 400, { ok: false, error: 'origin required (body.origin or Referer)' });
      return;
    }
    try {
      // eslint-disable-next-line no-new
      new URL(origin);
    } catch (e) {
      sendJson(res, 400, { ok: false, error: 'invalid origin' });
      return;
    }

    if (!isLocalRequest(req) && !clientMayPollDesktopSession(req, origin)) {
      sendJson(res, 403, {
        ok: false,
        error: 'declared origin does not match this request (Origin, Referer, or same-site Host)'
      });
      return;
    }

    const sessionId = randomSessionId();
    const nonce = randomNonce();
    const pollSecret = randomNonce();
    const message = buildLoginMessage(sessionId, origin, nonce);

    hub._desktopAuthSessions.set(sessionId, {
      origin,
      nonce,
      pollSecret,
      message,
      createdAt: Date.now(),
      status: 'pending'
    });

    sendJson(res, 200, {
      ok: true,
      sessionId,
      message,
      nonce,
      // Creator-only; never put this on fabric:// / QR (the signer does not redeem GET).
      pollSecret,
      // hub = site origin that holds the session (desktop/extension callback base).
      protocolUrl: `fabric://login?sessionId=${encodeURIComponent(sessionId)}&hub=${encodeURIComponent(origin)}`,
      // Both completion modes share the same challenge; clients pick one.
      signingModes: hub.allowHubSelfSign === true ? ['client', 'hub'] : ['client'],
      acceptsClientSignature: true
    });
  } catch (err) {
    console.error('[HUB:SESSIONS:CREATE]', err && err.stack ? err.stack : err);
    sendJson(res, 500, { ok: false, error: 'session create failed' });
  }
}

/**
 * Complete a pending login session.
 *
 * **Client-signed (player login):** body `{ fabric: "fabric:…" }` — a
 * `SITE_LOGIN_RESPONSE` the wallet built itself for the session's origin and
 * nonce. Crypto verification is the authenticator.
 *
 * **Hub self-sign:** empty body — the Hub signs a `SITE_LOGIN_RESPONSE` with
 * its root key so a browser can adopt this node's watch-only identity.
 * Opt-in via `hub.allowHubSelfSign === true` and **loopback only**.
 */
function handleDesktopSign (hub, req, res) {
  try {
    const sessionId = req && req.params && req.params.sessionId
      ? String(req.params.sessionId).trim()
      : '';
    if (!sessionId) {
      sendJson(res, 400, { ok: false, error: 'sessionId required in path' });
      return;
    }

    pruneSessions(hub);
    const session = hub._desktopAuthSessions.get(sessionId);
    if (!session || session.status !== 'pending') {
      sendJson(res, 404, { ok: false, error: 'unknown or expired session' });
      return;
    }

    const fabricUri = fabricUriFromBody(req && req.body);
    if (fabricUri) {
      const done = completeSessionWithFabricResponse(session, fabricUri);
      if (!done.ok) {
        sendJson(res, done.status, { ok: false, error: done.error });
        return;
      }
      sendJson(res, 200, { ...done.json, sessionId });
      return;
    }

    const body = req && req.body && typeof req.body === 'object' ? req.body : {};
    if (hub.allowHubSelfSign !== true || Object.keys(body).length > 0) {
      sendJson(res, 400, {
        ok: false,
        error: 'a signed SiteLoginResponse is required: { fabric: "fabric:…" }'
      });
      return;
    }

    if (!isLocalRequest(req)) {
      sendJson(res, 403, {
        ok: false,
        error: 'POST .../signatures (hub self-sign) requires loopback'
      });
      return;
    }

    if (!hub._rootKey || !hub._rootKey.private) {
      sendJson(res, 503, { ok: false, error: 'Hub identity has no private key' });
      return;
    }

    let signed;
    try {
      signed = require('@fabric/core/functions/fabricSiteLogin').signSiteLoginResponse({
        origin: session.origin,
        nonce: session.nonce,
        signer: 'hub',
        xpub: hub._rootKey.xpub || ''
      }, hub._rootKey);
    } catch (err) {
      sendJson(res, 501, { ok: false, error: `hub cannot sign a SiteLoginResponse: ${err && err.message ? err.message : err}` });
      return;
    }
    const done = completeSessionWithFabricResponse(session, signed.uri);
    if (!done.ok) {
      sendJson(res, done.status, { ok: false, error: done.error });
      return;
    }
    session.signer = 'hub';
    sendJson(res, 200, { ...done.json, signer: 'hub', sessionId });
  } catch (err) {
    console.error('[HUB:SESSIONS:SIGN]', err && err.stack ? err.stack : err);
    sendJson(res, 500, { ok: false, error: 'sign failed' });
  }
}

function handleSessionGet (hub, req, res) {
  try {
    if (typeof hub.serveSpaShellIfHtmlNavigation === 'function') {
      if (hub.serveSpaShellIfHtmlNavigation(hub, req, res)) return;
    }
    pruneSessions(hub);
    pruneDelegationRegistry(hub);
    const sessionId = req && req.params && req.params.sessionId ? String(req.params.sessionId).trim() : '';
    if (!sessionId) {
      sendJson(res, 400, { ok: false, error: 'sessionId required' });
      return;
    }

    const session = hub._desktopAuthSessions.get(sessionId);
    if (!session) {
      if (!hub._delegationRegistry) hub._delegationRegistry = new Map();
      const bearer = getBearerToken(req);
      // Opaque delegation token is the registry key — never treat path sessionId as the bearer.
      const delegationRow = bearer ? hub._delegationRegistry.get(bearer) : null;
      if (
        delegationRow &&
        delegationRow.sessionId != null &&
        tokensEqual(String(delegationRow.sessionId), sessionId)
      ) {
        sendJson(res, 200, {
          ok: true,
          session: {
            origin: delegationRow.origin,
            linkedAt: delegationRow.linkedAt,
            label: delegationRow.label || 'browser',
            identityId: delegationRow.identityId != null ? String(delegationRow.identityId) : null,
            externalSigning: true
          }
        });
        return;
      }
      // GET /sessions/:delegationToken — path is the opaque token; require matching Bearer.
      // Unauthenticated path lookup would let anyone who saw the token in a URL read origin/identityId.
      if (
        bearer &&
        tokensEqual(bearer, sessionId) &&
        typeof hub.getDelegationSessionById === 'function'
      ) {
        const delegationView = hub.getDelegationSessionById(sessionId);
        if (delegationView) {
          sendJson(res, 200, {
            ...delegationView,
            session: {
              origin: delegationView.origin,
              linkedAt: delegationView.linkedAt,
              label: delegationView.label || 'browser',
              identityId: delegationView.identityId != null ? String(delegationView.identityId) : null,
              externalSigning: true
            }
          });
          return;
        }
      }
      sendJson(res, 404, { ok: false, error: 'unknown or expired session' });
      return;
    }

    if (!clientMayPollDesktopSession(req, session.origin)) {
      sendJson(res, 403, { ok: false, error: 'origin does not match this session' });
      return;
    }

    if (session.status === 'pending') {
      sendJson(res, 200, {
        ok: true,
        status: 'pending',
        kind: 'desktop_login',
        sessionId,
        origin: session.origin,
        message: session.message,
        nonce: session.nonce,
        createdAt: session.createdAt,
        signingModes: hub.allowHubSelfSign === true ? ['client', 'hub'] : ['client'],
        acceptsClientSignature: true
      });
      return;
    }

    if (session.status === 'signed') {
      if (!requestMayRedeemSessionSecret(req, session)) {
        sendJson(res, 403, { ok: false, error: 'poll secret required to redeem this session' });
        return;
      }
      if (!hub._delegationRegistry) hub._delegationRegistry = new Map();
      pruneDelegationRegistry(hub);
      let delegationToken = session.delegationToken;
      if (!delegationToken) {
        delegationToken = randomSessionId();
        session.delegationToken = delegationToken;
        hub._delegationRegistry.set(delegationToken, {
          origin: session.origin,
          identityId: session.identity && session.identity.id != null ? session.identity.id : null,
          xpub: session.identity && session.identity.xpub ? session.identity.xpub : null,
          linkedAt: Date.now(),
          label: session.signer === 'client' ? 'fabric-client' : 'browser',
          sessionId,
          signer: session.signer || 'hub'
        });
      }
      const payload = {
        ok: true,
        status: 'signed',
        signer: session.signer || 'hub',
        identity: session.identity,
        delegationToken,
        signature: session.signature,
        pubkeyHex: session.pubkeyHex,
        message: session.message
      };
      if (session.fabric) {
        payload.fabric = session.fabric;
        payload.signerLabel = session.signerLabel;
      }
      hub._desktopAuthSessions.delete(sessionId);
      sendJson(res, 200, payload);
      return;
    }

    sendJson(res, 200, { ok: true, status: session.status || 'unknown' });
  } catch (err) {
    console.error('[HUB:SESSIONS:GET]', err && err.stack ? err.stack : err);
    sendJson(res, 500, { ok: false, error: 'session get failed' });
  }
}

function mountFabricDesktopAuthHttp (hub) {
  if (!hub._desktopAuthSessions) hub._desktopAuthSessions = new Map();
  // REST: `POST /sessions` create login session; `GET /sessions/:id` poll; desktop completes by creating a `signatures` subresource.
  hub.http._addRoute('POST', '/sessions/:sessionId/signatures', (req, res) => handleDesktopSign(hub, req, res));
  hub.http._addRoute('GET', '/sessions/:sessionId', (req, res) => handleSessionGet(hub, req, res));
  hub.http._addRoute('POST', '/sessions', (req, res) => handleSessionCreate(hub, req, res));
}

const mountFabricSiteLoginHttp = mountFabricDesktopAuthHttp;

module.exports = {
  DESKTOP_LOGIN_PREFIX,
  SESSION_TTL_MS,
  buildLoginMessage,
  randomNonce,
  randomSessionId,
  originsMatchForDesktopSession,
  handleSessionCreate,
  handleSessionGet,
  handleDesktopSign,
  mountFabricDesktopAuthHttp,
  mountFabricSiteLoginHttp,
  tokensEqual,
  requestMayRedeemSessionSecret
};
