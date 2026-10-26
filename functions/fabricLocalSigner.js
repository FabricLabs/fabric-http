'use strict';

/**
 * @fileoverview Local Passport signer for desktop apps (Hub, GoonCitizen).
 *
 * - `GET /services/fabric/identity` names the desktop identity. With
 *   `?pubkey=` it says whether that device is linked, to Passport only.
 * - `POST /services/fabric/sign` takes a `fabric:` `PASSPORT_SIGN_REQUEST`
 *   from a linked Passport device and, once the desktop user approves,
 *   returns a `PASSPORT_ASSERTION` signed by the desktop's own account on the
 *   challenge's network.
 * - `POST /services/fabric/link { sessionId }` (when the app passes
 *   `linkBase`) accepts a pending `/device-links` offer on this app as the
 *   responder, after the user matches the six-digit pairing code.
 *
 * Callers: a direct loopback socket naming a loopback Host (DNS-rebinding
 * guard) whose `Origin` is Passport: one of `extensionIds` as
 * `chrome-extension://<id>`, or any `moz-extension://` origin (Firefox ids
 * are random per install). Sign requests must be signed by a device in this
 * app's identity cluster, and each nonce is spent once.
 */

const { pairingCode, readSignRequest, signAssertion } = require('@fabric/core/functions/passport');
const {
  isLoopbackHostname,
  isLocalRequest,
  requestHasProxyForwardHeaders,
  fabricUriFromBody
} = require('./httpRequestTrust');
const { PASSPORT_OUTDATED, passportOutdated } = require('./passportHttp');
const { buildFabricIdentitySignedPayload, fabricIdentityIdFromPubkeyHex } = require('./fabricIdentitySchnorr');
const { fetchDeviceLinkSession, postDeviceLinkSignature, verifyDeviceLinkOffer } = require('./fabricDeviceLinkClient');
const { buildDeviceLinkMessage, isSessionIdHex, DEVICE_LINK_TAG } = require('./fabricDeviceLinkMessages');

const FABRIC_IDENTITY_PATH = '/services/fabric/identity';
const FABRIC_SIGN_PATH = '/services/fabric/sign';
const FABRIC_LINK_PATH = '/services/fabric/link';
const LINK_APPROVAL_MS = 2 * 60 * 1000;
/** Least time between two link prompts. */
const LINK_PROMPT_INTERVAL_MS = 30 * 1000;
/** Spent nonces are kept this long past their request's expiry. */
const NONCE_GRACE_MS = 30 * 1000;
const MAX_BODY_BYTES = 96 * 1024;
const MAX_SPENT_NONCES = 4096;
const CHROME_EXTENSION_ID = /^[a-p]{32}$/;

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
 * Whether `origin` is a Passport extension origin.
 * @param {string} origin
 * @param {string[]} extensionIds Chrome extension ids.
 * @returns {boolean}
 */
function isPassportOrigin (origin, extensionIds = []) {
  const value = String(origin || '');
  const moz = /^moz-extension:\/\/([0-9a-f-]{36})$/i.exec(value);
  if (moz) return true;
  const chrome = /^chrome-extension:\/\/([a-p]{32})$/.exec(value);
  return !!(chrome && extensionIds.includes(chrome[1]));
}

/**
 * Who may reach the local signer: direct loopback, loopback Host, and a
 * Passport `Origin` (or, with `allowNoOrigin`, none at all).
 * @param {import('http').IncomingMessage} req
 * @param {Object} [options]
 * @param {string[]} [options.extensionIds]
 * @param {boolean} [options.allowNoOrigin]
 * @returns {{ ok: true, passport: boolean }|{ ok: false, status: number, error: string }}
 */
function checkLocalSignerCaller (req, options = {}) {
  if (requestHasProxyForwardHeaders(req) || !isLocalRequest(req)) {
    return { ok: false, status: 403, error: 'the local signer answers loopback callers only' };
  }
  const host = hostnameOf(req && req.headers && req.headers.host);
  if (!isLoopbackHostname(host)) {
    return { ok: false, status: 421, error: 'Host must be localhost, 127.0.0.1, or [::1]' };
  }
  const origin = req && req.headers && req.headers.origin;
  if (origin == null || origin === '') {
    if (options.allowNoOrigin) return { ok: true, passport: false };
    return { ok: false, status: 403, error: 'only Passport can call the local signer' };
  }
  if (!isPassportOrigin(origin, options.extensionIds || [])) {
    return { ok: false, status: 403, error: 'only Passport can call the local signer' };
  }
  return { ok: true, passport: true };
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
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(json));
}

/**
 * Build the local signer for a desktop app.
 * @param {Object} options
 * @param {string} options.signer `hub` | `gooncitizen`
 * @param {string} [options.name] Display name shown to Passport.
 * @param {string[]} [options.extensionIds] Chrome extension ids of Passport builds to answer.
 * @param {string} options.network Network the desktop runs on (for links and the identity route).
 * @param {Function} options.getAccount `({ network, account }) => account|null` — the
 *   desktop's own account on that network (`deriveAccount` shape), null while locked.
 * @param {Function} options.linkedDevice `(xOnlyPubkeyHex) => (string|null)` — the device's
 *   compressed pubkey when it is in the identity cluster.
 * @param {Function} options.approve `(prompt) => boolean` — native desktop consent. `prompt`:
 *   `{ kind: 'sign', origin, purpose, device, network, account, shares, expiresAt }` or
 *   `{ kind: 'link', origin, label, device, code, expiresAt }`.
 * @param {Function} [options.linkBase] `() => string|null` — loopback origin of this app's own
 *   `/device-links`; enables `POST /services/fabric/link`.
 * @param {Function} [options.onLinkAccepted] `({ peerPubkey, nonce, sessionId, label, origin }) => void`
 * @param {Function} [options.now] Clock override `() => ms`
 * @returns {{ identity: Function, sign: Function, signFabricUri: Function, acceptDeviceLink: Function, link: Function, handle: Function, mount: Function }}
 */
function createFabricLocalSigner (options = {}) {
  const settings = Object.assign({
    name: null,
    extensionIds: [],
    now: () => Date.now(),
    maxBodyBytes: MAX_BODY_BYTES
  }, options);
  if (!['hub', 'gooncitizen'].includes(settings.signer)) {
    throw new TypeError('createFabricLocalSigner: signer must be hub or gooncitizen');
  }
  for (const hook of ['getAccount', 'linkedDevice', 'approve']) {
    if (typeof settings[hook] !== 'function') {
      throw new TypeError(`createFabricLocalSigner: ${hook} is required`);
    }
  }
  if (!settings.network) throw new TypeError('createFabricLocalSigner: network is required');
  const extensionIds = (settings.extensionIds || []).filter((id) => CHROME_EXTENSION_ID.test(String(id)));
  const gate = (req, allowNoOrigin = false) => checkLocalSignerCaller(req, { extensionIds, allowNoOrigin });
  const startedAt = settings.now();

  const spent = new Map();
  let signWaiting = false;
  let linkWaiting = false;
  let lastLinkPromptAt = -Infinity;

  function pruneSpent (now) {
    for (const [nonce, expiresAt] of spent) {
      if (expiresAt + NONCE_GRACE_MS <= now) spent.delete(nonce);
    }
  }

  function accountFor (network, account = null) {
    let out = null;
    try {
      out = settings.getAccount({ network, account });
    } catch (_) {}
    const key = out && out.identity && out.identity.key;
    if (!key || !key.private || typeof key.pubkey !== 'string') return null;
    return out;
  }

  function describe () {
    const account = accountFor(settings.network);
    const out = {
      ok: true,
      signer: settings.signer,
      name: settings.name,
      network: settings.network,
      locked: !account,
      pubkey: null,
      id: null,
      signPath: FABRIC_SIGN_PATH,
      linkPath: typeof settings.linkBase === 'function' ? FABRIC_LINK_PATH : null
    };
    if (account) {
      out.pubkey = account.identity.pubkey.toLowerCase();
      out.id = fabricIdentityIdFromPubkeyHex(out.pubkey);
    }
    return out;
  }

  async function lookupDevice (xOnly) {
    try {
      const device = await settings.linkedDevice(xOnly);
      const hex = typeof device === 'string' ? device.toLowerCase() : '';
      return /^0[23][0-9a-f]{64}$/.test(hex) && hex.slice(2) === xOnly ? hex : null;
    } catch (_) {
      return null;
    }
  }

  /**
   * Check, approve, and answer one `fabric:` `PASSPORT_SIGN_REQUEST`.
   * @param {string} uri
   * @returns {Promise<{ status: number, json: object }>}
   */
  async function signFabricUri (uri) {
    const now = settings.now();
    if (passportOutdated(uri, 'PASSPORT_SIGN_REQUEST')) return { status: 426, json: Object.assign({ ok: false }, PASSPORT_OUTDATED) };
    const read = readSignRequest(uri, { now });
    if (!read.ok) return { status: 400, json: { ok: false, error: read.error } };
    if (read.issuedAt < startedAt) return { status: 409, json: { ok: false, error: 'sign request predates this signer' } };

    const spentKey = `${read.author}:${read.nonce}`;
    pruneSpent(now);
    if (spent.has(spentKey)) return { status: 409, json: { ok: false, error: 'sign request already used' } };
    if (spent.size >= MAX_SPENT_NONCES) return { status: 429, json: { ok: false, error: 'too many sign requests' } };

    const device = await lookupDevice(read.author);
    if (!device) return { status: 403, json: { ok: false, error: 'this device is not linked to the desktop identity' } };

    const network = read.challenge.network || settings.network;
    const account = accountFor(network, read.account);
    if (!account) return { status: 503, json: { ok: false, locked: true, error: 'desktop identity is locked' } };
    if (read.disclose.includes('wallet') && !account.wallet) {
      return { status: 409, json: { ok: false, error: 'this desktop has no wallet keys to share' } };
    }
    if (read.disclose.includes('cosigner') && !(account.cosigner && account.cosigner.key)) {
      return { status: 409, json: { ok: false, error: 'this desktop has no cosigner key to share' } };
    }

    if (signWaiting) return { status: 429, json: { ok: false, error: 'another sign-in is waiting for approval' } };
    spent.set(spentKey, read.expiresAt);

    let approved = false;
    signWaiting = true;
    try {
      approved = await settings.approve({
        kind: 'sign',
        origin: read.origin,
        purpose: read.challenge.purpose || null,
        device,
        network,
        account: read.account,
        shares: ['identity'].concat(read.disclose),
        expiresAt: read.expiresAt
      });
    } catch (_) {
      approved = false;
    } finally {
      signWaiting = false;
    }
    if (approved !== true) return { status: 403, json: { ok: false, declined: true, error: 'declined on the desktop' } };

    const signedAt = settings.now();
    if (signedAt >= read.expiresAt) return { status: 410, json: { ok: false, error: 'sign request expired while waiting for approval' } };

    let signed;
    try {
      signed = signAssertion({
        challenge: read.challengeBuffer,
        origin: read.origin,
        signer: settings.signer,
        network,
        disclose: read.disclose,
        wallet: account.wallet,
        cosignerKey: account.cosigner && account.cosigner.key,
        device,
        now: signedAt
      }, account.identity.key);
    } catch (err) {
      return { status: 400, json: { ok: false, error: err.message } };
    }
    return {
      status: 200,
      json: {
        ok: true,
        signer: settings.signer,
        identity: signed.identity,
        network: signed.network,
        disclosed: signed.disclosed,
        fabric: signed.uri,
        expiresAt: signed.expiresAt
      }
    };
  }

  function ownLinkBase () {
    if (typeof settings.linkBase !== 'function') return null;
    let url;
    try {
      url = new URL(String(settings.linkBase() || ''));
    } catch (_) {
      return null;
    }
    return url.protocol === 'http:' && isLoopbackHostname(hostnameOf(url.host)) ? url.origin : null;
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
    const account = accountFor(settings.network);
    if (!account) return { status: 503, json: { ok: false, locked: true, error: 'desktop identity is locked' } };
    const key = account.identity.key;

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
    const ownPubkey = key.pubkey.toLowerCase();
    const ownId = fabricIdentityIdFromPubkeyHex(ownPubkey);
    if (initiator.id === ownId) return { status: 400, json: { ok: false, error: 'cannot link the desktop to itself' } };

    if (linkWaiting) return { status: 429, json: { ok: false, error: 'another link is waiting for approval' } };
    const now = settings.now();
    if (now - lastLinkPromptAt < LINK_PROMPT_INTERVAL_MS) {
      return { status: 429, json: { ok: false, error: 'wait before asking to link again' } };
    }
    lastLinkPromptAt = now;
    const label = String(st.label || 'device');
    const code = pairingCode(initiatorPubkey, ownPubkey);
    let approved = false;
    linkWaiting = true;
    try {
      approved = await settings.approve({
        kind: 'link',
        origin: base,
        label,
        device: initiatorPubkey,
        code,
        expiresAt: now + LINK_APPROVAL_MS
      });
    } catch (_) {
      approved = false;
    } finally {
      linkWaiting = false;
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
        code,
        identity: { id: ownId, pubkey: ownPubkey }
      }
    };
  }

  async function link (req, res) {
    const checked = gate(req);
    if (!checked.ok) return sendJson(res, checked.status, { ok: false, error: checked.error });
    let body = req && req.body;
    if (!body || typeof body !== 'object' || !body.sessionId) {
      try {
        body = JSON.parse(await readRequestText(req, 4096));
      } catch (_) {
        body = null;
      }
    }
    const out = await acceptDeviceLink(body && body.sessionId);
    sendJson(res, out.status, out.json);
  }

  async function identity (req, res) {
    const checked = gate(req, true);
    if (!checked.ok) return sendJson(res, checked.status, { ok: false, error: checked.error });
    const out = describe();
    let pubkeyQuery = '';
    try {
      const url = new URL(req.url || '/', 'http://localhost');
      pubkeyQuery = String(url.searchParams.get('pubkey') || '').toLowerCase();
    } catch (_) {}
    if (checked.passport && /^(0[23])?[0-9a-f]{64}$/.test(pubkeyQuery)) {
      const xOnly = pubkeyQuery.length === 66 ? pubkeyQuery.slice(2) : pubkeyQuery;
      out.linked = !!(await lookupDevice(xOnly));
    }
    sendJson(res, 200, out);
  }

  async function sign (req, res) {
    const checked = gate(req);
    if (!checked.ok) return sendJson(res, checked.status, { ok: false, error: checked.error });
    let uri = null;
    try {
      uri = await readRequestFabricUri(req, settings.maxBodyBytes);
    } catch (err) {
      return sendJson(res, err && err.status ? err.status : 400, { ok: false, error: 'unreadable request body' });
    }
    if (!uri) return sendJson(res, 400, { ok: false, error: 'body must be a fabric: PASSPORT_SIGN_REQUEST' });
    const out = await signFabricUri(uri);
    sendJson(res, out.status, out.json);
  }

  const failed = (res, what) => () => sendJson(res, 500, { ok: false, error: `${what} failed` });

  /**
   * Plain `http` router hook. Returns true when it answered.
   * @param {import('http').IncomingMessage} req
   * @param {import('http').ServerResponse} res
   * @param {string} pathname
   * @returns {boolean}
   */
  function handle (req, res, pathname) {
    if (pathname === FABRIC_IDENTITY_PATH && req.method === 'GET') {
      identity(req, res).catch(failed(res, 'identity'));
      return true;
    }
    if (pathname === FABRIC_SIGN_PATH && req.method === 'POST') {
      sign(req, res).catch(failed(res, 'sign'));
      return true;
    }
    if (pathname === FABRIC_LINK_PATH && req.method === 'POST' && ownLinkBase()) {
      link(req, res).catch(failed(res, 'link'));
      return true;
    }
    return false;
  }

  /**
   * Mount on an Express app (or `HTTPServer#express`).
   * @param {object} app
   */
  function mount (app) {
    app.get(FABRIC_IDENTITY_PATH, (req, res) => identity(req, res).catch(failed(res, 'identity')));
    app.post(FABRIC_SIGN_PATH, (req, res) => sign(req, res).catch(failed(res, 'sign')));
    if (typeof settings.linkBase === 'function') {
      app.post(FABRIC_LINK_PATH, (req, res) => link(req, res).catch(failed(res, 'link')));
    }
  }

  return { identity, sign, signFabricUri, acceptDeviceLink, link, handle, mount };
}

module.exports = {
  FABRIC_IDENTITY_PATH,
  FABRIC_SIGN_PATH,
  FABRIC_LINK_PATH,
  LINK_PROMPT_INTERVAL_MS,
  NONCE_GRACE_MS,
  isPassportOrigin,
  checkLocalSignerCaller,
  createFabricLocalSigner
};
