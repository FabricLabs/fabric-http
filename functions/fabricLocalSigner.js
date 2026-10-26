'use strict';

/**
 * Local `fabric:` signer for desktop apps (Hub, GoonCitizen).
 *
 * `GET /services/fabric/identity` names the desktop identity (pubkey + id).
 * `POST /services/fabric/sign` takes a `fabric:` `FabricSignRequest` from a
 * linked device (Passport) and, once the desktop user approves, returns a
 * `fabric:` `SiteLoginResponse` signed by the desktop key for the site that
 * asked.
 *
 * `POST /services/fabric/link` (when the app passes `linkBase`) accepts a
 * pending `/device-links` session on this app as the responder, after the
 * desktop user approves, so a Passport can link to the desktop identity.
 *
 * Every route answers only direct loopback callers that name a loopback Host
 * (DNS-rebinding guard) and carry no web page Origin; browser extensions and
 * native clients pass. The signature on the request is the authenticator:
 * its author must be a device in this app's identity cluster
 * (`isLinkedDevice`), and each request nonce is spent once.
 */

const {
  isLoopbackHostname,
  isLocalRequest,
  requestHasProxyForwardHeaders,
  fabricUriFromBody,
  buildFabricIdentitySignedPayload,
  fabricIdentityIdFromPubkeyHex
} = require('./fabricSiteLoginVerify');
const { fetchDeviceLinkSession, postDeviceLinkSignature, verifyDeviceLinkOffer } = require('./fabricDeviceLinkClient');
const { buildDeviceLinkMessage, isSessionIdHex, DEVICE_LINK_TAG } = require('./fabricDeviceLinkMessages');

const FABRIC_IDENTITY_PATH = '/services/fabric/identity';
const FABRIC_SIGN_PATH = '/services/fabric/sign';
const FABRIC_LINK_PATH = '/services/fabric/link';
const LINK_APPROVAL_MS = 2 * 60 * 1000;
const MAX_BODY_BYTES = 96 * 1024;
const MAX_SPENT_NONCES = 4096;
const EXTENSION_ORIGIN = /^(chrome|moz|safari-web)-extension:\/\/[^/]+$/i;

/**
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
 * Hostname of a Host header (`127.0.0.1:8080`, `[::1]:3041`, `localhost`).
 * @private
 * @param {string} host
 * @returns {string}
 */
function hostnameOf (host) {
  const h = String(host || '').trim().toLowerCase();
  if (h.startsWith('[')) {
    const end = h.indexOf(']');
    return end > 0 ? h.slice(0, end + 1) : h;
  }
  const colon = h.lastIndexOf(':');
  return colon > 0 ? h.slice(0, colon) : h;
}

/**
 * Who may reach the local signer: direct loopback, loopback Host, and either
 * no Origin or a browser-extension Origin.
 * @param {import('http').IncomingMessage} req
 * @returns {{ ok: true }|{ ok: false, status: number, error: string }}
 */
function checkLocalSignerCaller (req) {
  if (requestHasProxyForwardHeaders(req) || !isLocalRequest(req)) {
    return { ok: false, status: 403, error: 'the local signer answers loopback callers only' };
  }
  const host = hostnameOf(req && req.headers && req.headers.host);
  if (!isLoopbackHostname(host)) {
    return { ok: false, status: 421, error: 'Host must be localhost, 127.0.0.1, or [::1]' };
  }
  const origin = req && req.headers && req.headers.origin;
  if (origin != null && origin !== '' && !EXTENSION_ORIGIN.test(String(origin))) {
    return { ok: false, status: 403, error: 'web pages cannot call the local signer' };
  }
  return { ok: true };
}

/**
 * @private
 * @param {import('http').IncomingMessage} req
 * @param {number} limit
 * @returns {Promise<string>}
 */
function readRequestText (req, limit) {
  if (!req || typeof req.on !== 'function' || req.readableEnded || req.complete) {
    return Promise.resolve('');
  }
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(Object.assign(new Error('request body too large'), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8').trim()));
    req.on('error', reject);
  });
}

/**
 * @private
 * @param {import('http').IncomingMessage} req
 * @param {number} limit
 * @returns {Promise<string|null>}
 */
async function readRequestFabricUri (req, limit) {
  const parsed = fabricUriFromBody(req && req.body);
  if (parsed) return parsed.length <= limit ? parsed : null;
  const text = await readRequestText(req, limit);
  if (/^fabric:/i.test(text)) return text;
  try {
    return fabricUriFromBody(JSON.parse(text));
  } catch (_) {
    return null;
  }
}

/**
 * @private
 * @param {import('http').ServerResponse} res
 * @param {number} status
 * @param {object} json
 */
function sendJson (res, status, json) {
  if (typeof res.status === 'function' && typeof res.json === 'function') {
    res.status(status).json(json);
    return;
  }
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(json));
}

/**
 * Build the local signer for a desktop app.
 * @param {Object} options
 * @param {string} options.signer `hub` | `gooncitizen` | `desktop` (label in the response)
 * @param {string} [options.name] Display name shown to Passport
 * @param {Function} options.getKey `() => Key|null` — the unlocked desktop key (null while locked)
 * @param {Function} options.isLinkedDevice `(xOnlyPubkeyHex) => boolean|Promise<boolean>` — identity-cluster check
 * @param {Function} options.approve `({ kind, origin, purpose, device, expiresAt }) => boolean|Promise<boolean>` — desktop user consent; `kind` is `sign` or `link`
 * @param {Function} [options.includeXpub] `(origin) => boolean` — attach the desktop xpub (default: never)
 * @param {Function} [options.linkBase] `() => string|null` — loopback origin of this app's own `/device-links`; enables `POST /services/fabric/link`
 * @param {Function} [options.onLinkAccepted] `({ peerPubkey, nonce, sessionId, label, origin }) => void` — publish this side's IdentityCrossSign
 * @param {Function} [options.now] Clock override `() => ms`
 * @returns {{ identity: Function, sign: Function, signFabricUri: Function, acceptDeviceLink: Function, link: Function, handle: Function, mount: Function }}
 */
function createFabricLocalSigner (options = {}) {
  const settings = Object.assign({
    name: null,
    includeXpub: () => false,
    now: () => Date.now(),
    maxBodyBytes: MAX_BODY_BYTES
  }, options);
  if (!['hub', 'gooncitizen', 'desktop'].includes(settings.signer)) {
    throw new TypeError('createFabricLocalSigner: signer must be hub, gooncitizen, or desktop');
  }
  for (const hook of ['getKey', 'isLinkedDevice', 'approve']) {
    if (typeof settings[hook] !== 'function') {
      throw new TypeError(`createFabricLocalSigner: ${hook} is required`);
    }
  }

  const spent = new Map();
  let waiting = null;

  function pruneSpent (now) {
    for (const [nonce, expiresAt] of spent) {
      if (expiresAt <= now) spent.delete(nonce);
    }
  }

  function currentKey () {
    let key = null;
    try {
      key = settings.getKey();
    } catch (_) {}
    if (!key || !key.private || typeof key.pubkey !== 'string') return null;
    return key;
  }

  function describe () {
    const core = loadCoreSiteLogin();
    const key = currentKey();
    const out = {
      ok: true,
      signer: settings.signer,
      name: settings.name,
      available: !!core,
      locked: !key,
      pubkey: null,
      id: null,
      signPath: FABRIC_SIGN_PATH,
      linkPath: typeof settings.linkBase === 'function' ? FABRIC_LINK_PATH : null
    };
    if (key) {
      out.pubkey = key.pubkey.toLowerCase();
      try {
        const { fabricIdentityIdFromPubkeyHex } = require('./fabricIdentitySchnorr');
        out.id = fabricIdentityIdFromPubkeyHex(out.pubkey);
      } catch (_) {}
    }
    return out;
  }

  /**
   * Check, approve, and answer one `fabric:` `FabricSignRequest`.
   * @param {string} uri
   * @returns {Promise<{ status: number, json: object }>}
   */
  async function signFabricUri (uri) {
    const core = loadCoreSiteLogin();
    if (!core) return { status: 501, json: { ok: false, available: false, error: 'fabric: signing needs a newer @fabric/core' } };
    const now = settings.now();
    const read = core.readFabricSignRequest(uri, { now });
    if (!read.ok) return { status: 400, json: { ok: false, error: read.error } };

    const spentKey = `${read.author}:${read.nonce}`;
    pruneSpent(now);
    if (spent.has(spentKey)) return { status: 409, json: { ok: false, error: 'sign request already used' } };
    if (spent.size >= MAX_SPENT_NONCES) return { status: 429, json: { ok: false, error: 'too many sign requests' } };

    let linked = false;
    try {
      linked = await settings.isLinkedDevice(read.author);
    } catch (_) {}
    if (linked !== true) return { status: 403, json: { ok: false, error: 'this device is not linked to the desktop identity' } };

    const key = currentKey();
    if (!key) return { status: 503, json: { ok: false, locked: true, error: 'desktop identity is locked' } };

    if (waiting) return { status: 429, json: { ok: false, error: 'another sign-in is waiting for approval' } };
    spent.set(spentKey, read.expiresAt);

    let approved = false;
    waiting = read.nonce;
    try {
      approved = await settings.approve({
        kind: 'sign',
        origin: read.origin,
        purpose: read.request.purpose || null,
        device: read.author,
        expiresAt: read.expiresAt
      });
    } catch (_) {
      approved = false;
    } finally {
      waiting = null;
    }
    if (approved !== true) return { status: 403, json: { ok: false, declined: true, error: 'declined on the desktop' } };

    const signedAt = settings.now();
    if (signedAt >= read.expiresAt) return { status: 410, json: { ok: false, error: 'sign request expired while waiting for approval' } };

    let xpub = null;
    try {
      if (settings.includeXpub(read.origin) === true && key.xpub) xpub = key.xpub;
    } catch (_) {}

    const signed = core.signSiteLoginResponse({
      origin: read.origin,
      nonce: read.request.nonce,
      signer: settings.signer,
      xpub,
      now: signedAt
    }, key);
    return {
      status: 200,
      json: {
        ok: true,
        signer: settings.signer,
        identity: { id: signed.identity.id, pubkey: signed.identity.pubkey },
        fabric: signed.uri,
        expiresAt: signed.expiresAt
      }
    };
  }

  function ownLinkBase () {
    if (typeof settings.linkBase !== 'function') return null;
    let base = null;
    try {
      base = new URL(String(settings.linkBase() || '')).origin;
    } catch (_) {
      return null;
    }
    const host = hostnameOf(new URL(base).host);
    return base.startsWith('http://') && isLoopbackHostname(host) ? base : null;
  }

  /**
   * Accept a pending device-link session on this app as the responder.
   * @param {string} sessionId
   * @returns {Promise<{ status: number, json: object }>}
   */
  async function acceptDeviceLink (sessionId) {
    const base = ownLinkBase();
    if (!base) return { status: 404, json: { ok: false, error: 'this app does not accept device links here' } };
    const sid = String(sessionId || '').trim().toLowerCase();
    if (!isSessionIdHex(sid)) return { status: 400, json: { ok: false, error: 'sessionId must be 48 hex chars' } };
    const key = currentKey();
    if (!key) return { status: 503, json: { ok: false, locked: true, error: 'desktop identity is locked' } };
    if (!key.xpub) return { status: 503, json: { ok: false, error: 'desktop key has no xpub' } };

    let st;
    try {
      st = await fetchDeviceLinkSession(base, sid, { origin: base });
    } catch (_) {
      return { status: 502, json: { ok: false, error: 'could not read the device-link session' } };
    }
    if (!st || !st.ok) return { status: 404, json: { ok: false, error: (st && st.error) || 'unknown device-link session' } };
    if (st.status !== 'pending' || st.sessionId !== sid) {
      return { status: 409, json: { ok: false, error: 'device link is not waiting for this desktop' } };
    }
    const offer = verifyDeviceLinkOffer(st, base);
    if (!offer.ok) return { status: 409, json: { ok: false, error: offer.error } };
    const initiator = offer.initiator;
    const initiatorPubkey = initiator.pubkeyHex;
    const ownId = fabricIdentityIdFromPubkeyHex(key.pubkey.toLowerCase());
    if (initiator.id === ownId) return { status: 400, json: { ok: false, error: 'cannot link the desktop to itself' } };

    if (waiting) return { status: 429, json: { ok: false, error: 'another request is waiting for approval' } };
    const label = String(st.label || 'device');
    let approved = false;
    waiting = sid;
    try {
      approved = await settings.approve({
        kind: 'link',
        origin: base,
        purpose: label,
        device: initiatorPubkey.slice(2),
        expiresAt: settings.now() + LINK_APPROVAL_MS
      });
    } catch (_) {
      approved = false;
    } finally {
      waiting = null;
    }
    if (approved !== true) return { status: 403, json: { ok: false, declined: true, error: 'declined on the desktop' } };

    const linkMessage = buildDeviceLinkMessage(sid, st.nonce, initiator.id, ownId, label, offer.origin);
    const signed = buildFabricIdentitySignedPayload({ fabricKey: key, identityId: ownId }, linkMessage, DEVICE_LINK_TAG);
    let posted;
    try {
      posted = await postDeviceLinkSignature(base, sid, {
        role: 'responder',
        signature: signed.signature,
        pubkeyHex: signed.pubkeyHex,
        identity: signed.identity
      }, { origin: base });
    } catch (_) {
      posted = { ok: false, error: 'could not post the link signature' };
    }
    if (!posted || !posted.ok) return { status: 502, json: { ok: false, error: (posted && posted.error) || 'link signature refused' } };

    if (typeof settings.onLinkAccepted === 'function') {
      try {
        await settings.onLinkAccepted({ peerPubkey: initiatorPubkey, nonce: st.nonce, sessionId: sid, label, origin: offer.origin });
      } catch (_) {}
    }
    return {
      status: 200,
      json: {
        ok: true,
        status: 'accepted',
        sessionId: sid,
        signer: settings.signer,
        identity: { id: ownId, pubkey: key.pubkey.toLowerCase() }
      }
    };
  }

  async function link (req, res) {
    const gate = checkLocalSignerCaller(req);
    if (!gate.ok) return sendJson(res, gate.status, { ok: false, error: gate.error });
    let body = req && req.body;
    if (!body || typeof body !== 'object') {
      try {
        body = JSON.parse(await readRequestText(req, 4096));
      } catch (_) {
        body = null;
      }
    }
    const out = await acceptDeviceLink(body && body.sessionId);
    sendJson(res, out.status, out.json);
  }

  function identity (req, res) {
    const gate = checkLocalSignerCaller(req);
    if (!gate.ok) return sendJson(res, gate.status, { ok: false, error: gate.error });
    const out = describe();
    let pubkeyQuery = '';
    try {
      const url = new URL(req.url || '/', 'http://localhost');
      pubkeyQuery = String(url.searchParams.get('pubkey') || '').toLowerCase();
    } catch (_) {}
    const finish = (linked) => {
      if (linked != null) out.linked = linked === true;
      sendJson(res, 200, out);
    };
    if (!/^(0[23])?[0-9a-f]{64}$/.test(pubkeyQuery)) return finish(null);
    const xOnly = pubkeyQuery.length === 66 ? pubkeyQuery.slice(2) : pubkeyQuery;
    Promise.resolve()
      .then(() => settings.isLinkedDevice(xOnly))
      .then(finish, () => finish(false));
  }

  async function sign (req, res) {
    const gate = checkLocalSignerCaller(req);
    if (!gate.ok) return sendJson(res, gate.status, { ok: false, error: gate.error });
    let uri = null;
    try {
      uri = await readRequestFabricUri(req, settings.maxBodyBytes);
    } catch (err) {
      return sendJson(res, err && err.status ? err.status : 400, { ok: false, error: 'unreadable request body' });
    }
    if (!uri) return sendJson(res, 400, { ok: false, error: 'body must be a fabric: FabricSignRequest' });
    const out = await signFabricUri(uri);
    sendJson(res, out.status, out.json);
  }

  /**
   * Plain `http` router hook. Returns true when it answered.
   * @param {import('http').IncomingMessage} req
   * @param {import('http').ServerResponse} res
   * @param {string} pathname
   * @returns {boolean}
   */
  function handle (req, res, pathname) {
    if (pathname === FABRIC_IDENTITY_PATH && req.method === 'GET') {
      identity(req, res);
      return true;
    }
    if (pathname === FABRIC_SIGN_PATH && req.method === 'POST') {
      sign(req, res).catch(() => sendJson(res, 500, { ok: false, error: 'sign failed' }));
      return true;
    }
    if (pathname === FABRIC_LINK_PATH && req.method === 'POST' && ownLinkBase()) {
      link(req, res).catch(() => sendJson(res, 500, { ok: false, error: 'link failed' }));
      return true;
    }
    if ((pathname === FABRIC_IDENTITY_PATH || pathname === FABRIC_SIGN_PATH) && req.method === 'OPTIONS') {
      res.writeHead(204, { Allow: pathname === FABRIC_SIGN_PATH ? 'POST' : 'GET' });
      res.end();
      return true;
    }
    return false;
  }

  /**
   * Mount on an Express app (or `HTTPServer#express`).
   * @param {object} app
   */
  function mount (app) {
    app.get(FABRIC_IDENTITY_PATH, identity);
    app.post(FABRIC_SIGN_PATH, (req, res) => {
      sign(req, res).catch(() => sendJson(res, 500, { ok: false, error: 'sign failed' }));
    });
    if (typeof settings.linkBase === 'function') {
      app.post(FABRIC_LINK_PATH, (req, res) => {
        link(req, res).catch(() => sendJson(res, 500, { ok: false, error: 'link failed' }));
      });
    }
  }

  return { identity, sign, signFabricUri, acceptDeviceLink, link, handle, mount };
}

module.exports = {
  FABRIC_IDENTITY_PATH,
  FABRIC_SIGN_PATH,
  FABRIC_LINK_PATH,
  checkLocalSignerCaller,
  createFabricLocalSigner
};
