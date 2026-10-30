'use strict';

/**
 * @fileoverview Local delegate for desktop apps (Hub, GoonCitizen): Passport
 * on the same machine pairs with the app and asks it to sign, all as
 * delegation frames (`@fabric/core/functions/delegation`) handled by the
 * app's own `Delegation` (`@fabric/core/types/delegation`).
 *
 * - `GET /services/delegation` names the delegate; with `?pubkey=` it says
 *   whether that participant holds a grant from it.
 * - `POST /services/delegation/links { frame }` pairs: an offer gets this
 *   app's answer; the reveal gets the code, which `confirmLink` asks the user
 *   to match; then Passport's grant (naming its `extensionOrigin`) gets this
 *   app's grants back (`grantsForLink`).
 * - `POST /services/delegation/requests { frame }` takes a
 *   `DELEGATION_REQUEST`. The app's `decide` hook says `sign`, `decline`, or
 *   `notify` (the default: the request waits in the app's notifications and
 *   `GET /services/delegation/requests/:hash` returns the result once the
 *   user answers there).
 *
 * Callers: a direct loopback socket naming a loopback Host (DNS-rebinding
 * guard) with a browser-extension `Origin`. Requests are taken only from the
 * origin a grant from the requester recorded (`extensionOrigin`) or one the
 * app configured (`extensionOrigins`, `extensionIds`); pairing also accepts
 * configured origins and, because Firefox ids are random per install, any
 * `moz-extension://` origin, which the requester's grant must then name.
 * Anything other than a delegation frame gets 426 (an older Passport).
 */

const delegation = require('@fabric/core/functions/delegation');
const { decodeFabricUri, encodeFabricUri } = require('@fabric/core/functions/fabricUri');
const { isLoopbackHostname, isLocalRequest, requestHasProxyForwardHeaders } = require('./httpRequestTrust');
const { PASSPORT_OUTDATED } = require('./passportHttp');
const { readFrame, sendJson } = require('./delegationHttpBody');

const DELEGATE_PATH = '/services/delegation';
const DELEGATE_LINKS_PATH = '/services/delegation/links';
const DELEGATE_REQUESTS_PATH = '/services/delegation/requests';
/** Least time between two pairing prompts. */
const LINK_PROMPT_INTERVAL_MS = 30 * 1000;
const CHROME_EXTENSION_ID = /^[a-p]{32}$/;
const DECISIONS = ['sign', 'decline', 'notify'];

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
 * Who may reach the delegate at all: a direct loopback socket, a loopback
 * Host, and a browser-extension `Origin` (or none, with `allowNoOrigin`).
 * Which extension may do what is decided per route.
 * @param {import('http').IncomingMessage} req
 * @param {{ allowNoOrigin: (boolean|undefined) }} [options]
 * @returns {{ ok: true, origin: (string|null) }|{ ok: false, status: number, error: string }}
 */
function checkDelegateCaller (req, options = {}) {
  if (requestHasProxyForwardHeaders(req) || !isLocalRequest(req)) {
    return { ok: false, status: 403, error: 'the delegate answers loopback callers only' };
  }
  const host = hostnameOf(req && req.headers && req.headers.host);
  if (!isLoopbackHostname(host)) {
    return { ok: false, status: 421, error: 'Host must be localhost, 127.0.0.1, or [::1]' };
  }
  const header = req && req.headers && req.headers.origin;
  if (header == null || header === '') {
    if (options.allowNoOrigin) return { ok: true, origin: null };
    return { ok: false, status: 403, error: 'only Passport can call the delegate' };
  }
  const origin = delegation.normalizeExtensionOrigin(String(header));
  if (!origin || origin !== String(header).toLowerCase()) {
    return { ok: false, status: 403, error: 'only Passport can call the delegate' };
  }
  return { ok: true, origin };
}

/**
 * Turn whatever `decide` returned into `{ action, reason, rule }`.
 * @private
 */
function normalizeDecision (value) {
  const out = typeof value === 'string' ? { action: value } : (value && typeof value === 'object' ? value : {});
  const action = DECISIONS.includes(out.action) ? out.action : 'notify';
  return {
    action,
    reason: typeof out.reason === 'string' && out.reason ? out.reason.slice(0, 200) : undefined,
    rule: typeof out.rule === 'string' && out.rule ? out.rule.slice(0, 64) : undefined
  };
}

/**
 * Build the local delegate for a desktop app.
 * @param {Object} options
 * @param {Object} options.delegation The app's `Delegation` (keyed with its identity key).
 * @param {string} options.signer `hub` | `gooncitizen`
 * @param {string} options.network Network the app's identity key is on.
 * @param {string} [options.name] Display name shown to Passport.
 * @param {Function} options.getAccount `({ network, account }) => account|null` (`deriveAccount` shape), null while locked.
 * @param {Function} [options.decide] `(item) => 'sign'|'decline'|'notify'` or `{ action, reason, rule }` (may be async);
 *   `item` is `{ hash, scope, read, grant, notification, origin }`. Defaults to `notify`.
 * @param {Function} [options.answer] `(item, account) => frame` for scopes the delegate does not answer itself (`federation`).
 * @param {Function} [options.confirmLink] `({ linkId, sas, peer, peerLabel, origin }) => boolean` (may be async): the user saw the same code on both screens.
 * @param {Function} [options.grantsForLink] `({ linkId, peer, peerLabel, revealHash, origin }) => Array<object>` grant params to give a newly paired participant (default: `identity` + `passport`).
 * @param {string[]} [options.extensionOrigins] Extension origins always accepted.
 * @param {string[]} [options.extensionIds] Chrome extension ids always accepted.
 * @param {Function} [options.now]
 * @returns {{ describe: Function, takeLinkFrame: Function, takeRequest: Function, takeRemote: Function, resolve: Function, requestStatus: Function, handle: Function, mount: Function }}
 */
function createFabricDelegate (options = {}) {
  const settings = Object.assign({ name: null, extensionOrigins: [], extensionIds: [], now: () => Date.now() }, options);
  const store = settings.delegation;
  if (!store || typeof store.receive !== 'function' || typeof store.grants !== 'function') {
    throw new TypeError('createFabricDelegate: delegation is required');
  }
  if (!['hub', 'gooncitizen'].includes(settings.signer)) {
    throw new TypeError('createFabricDelegate: signer must be hub or gooncitizen');
  }
  if (typeof settings.getAccount !== 'function') throw new TypeError('createFabricDelegate: getAccount is required');
  if (!settings.network) throw new TypeError('createFabricDelegate: network is required');

  const configured = new Set();
  for (const o of settings.extensionOrigins || []) {
    const n = delegation.normalizeExtensionOrigin(o);
    if (n) configured.add(n);
  }
  for (const id of settings.extensionIds || []) {
    if (CHROME_EXTENSION_ID.test(String(id))) configured.add(`chrome-extension://${id}`);
  }
  const linkOrigins = new Map();
  let linkWaiting = false;
  let lastLinkPromptAt = -Infinity;

  function accountFor (network, account = 0) {
    let out = null;
    try {
      out = settings.getAccount({ network, account });
    } catch (_) {}
    const key = out && out.identity && out.identity.key;
    if (!key || !key.private || typeof key.pubkey !== 'string') return null;
    return out;
  }

  async function grantOrigins (requester) {
    const x = delegation.xOnly(requester);
    const received = await store.grants('received');
    return new Set(received
      .filter((g) => g.grant.grantor.slice(2) === x && g.grant.extensionOrigin)
      .map((g) => g.grant.extensionOrigin));
  }

  async function describe (query = {}) {
    const account = accountFor(settings.network);
    const out = {
      ok: true,
      signer: settings.signer,
      name: settings.name,
      network: settings.network,
      locked: !account,
      pubkey: store.pubkey || null,
      linksPath: DELEGATE_LINKS_PATH,
      requestsPath: DELEGATE_REQUESTS_PATH
    };
    const x = delegation.xOnly(query.pubkey);
    if (x && query.origin) {
      const given = await store.grants('given');
      const held = given.filter((g) => g.grant.grantee.slice(2) === x);
      const origins = await grantOrigins(x);
      out.granted = held.length > 0 && (origins.has(query.origin) || configured.has(query.origin));
      if (out.granted) out.scopes = Array.from(new Set([].concat(...held.map((g) => g.grant.scopes))));
    }
    return out;
  }

  async function issueGrants (link, origin) {
    const given = await store.grants('given');
    if (given.some((g) => g.grant.link === link.revealHash)) return given.filter((g) => g.grant.link === link.revealHash).map((g) => g.uri);
    let wanted = [{ scopes: ['identity', 'passport'] }];
    if (typeof settings.grantsForLink === 'function') {
      try {
        const custom = await settings.grantsForLink({ linkId: link.linkId, peer: link.peerPubkey, peerLabel: link.peerLabel, revealHash: link.revealHash, origin });
        if (Array.isArray(custom)) wanted = custom;
      } catch (_) {
        wanted = [];
      }
    }
    const out = [];
    for (const params of wanted) {
      const made = await store.grant(Object.assign({}, params, { grantee: link.peerPubkey, link: link.revealHash }));
      out.push(made.uri);
    }
    return out;
  }

  /**
   * Take one pairing frame from Passport.
   * @param {string} frame
   * @param {string} origin The caller's extension origin.
   * @returns {Promise<{ status: number, json: object }>}
   */
  async function takeLinkFrame (frame, origin) {
    const type = delegation.delegationType(frame);
    if (type === 'DELEGATION_LINK_OFFER') {
      if (!configured.has(origin) && !origin.startsWith('moz-extension://')) {
        return { status: 403, json: { ok: false, error: 'this extension is not set up to pair here' } };
      }
      if (origin.startsWith('moz-extension://') && !configured.has(origin)) {
        const pins = new Set();
        const received = await store.grants('received');
        for (const item of received) {
          const pinned = item && item.grant && item.grant.extensionOrigin;
          if (typeof pinned === 'string' && pinned.startsWith('moz-extension://')) pins.add(pinned);
        }
        if (pins.size && !pins.has(origin)) {
          return { status: 403, json: { ok: false, error: 'this browser is already paired with another Passport' } };
        }
      }
      const now = settings.now();
      if (linkWaiting || now - lastLinkPromptAt < LINK_PROMPT_INTERVAL_MS) {
        return { status: 429, json: { ok: false, error: 'wait before pairing again' } };
      }
      try {
        const made = await store.answer(frame, { label: settings.name || settings.signer });
        linkOrigins.set(made.linkId, origin);
        return { status: 201, json: { ok: true, linkId: made.linkId, frame: made.uri } };
      } catch (err) {
        return { status: 400, json: { ok: false, error: err.message } };
      }
    }
    if (type === 'DELEGATION_LINK_REVEAL') {
      const taken = await store.receive(frame);
      if (!taken.ok) return { status: 400, json: { ok: false, error: taken.error } };
      if (linkOrigins.get(taken.linkId) !== origin) return { status: 403, json: { ok: false, error: 'pairing started from another origin' } };
      let confirmed = false;
      linkWaiting = true;
      lastLinkPromptAt = settings.now();
      try {
        confirmed = typeof settings.confirmLink === 'function'
          ? (await settings.confirmLink({ linkId: taken.linkId, sas: taken.sas, peer: taken.peer, peerLabel: taken.peerLabel || '', origin })) === true
          : false;
      } catch (_) {
        confirmed = false;
      } finally {
        linkWaiting = false;
      }
      if (!confirmed) return { status: 403, json: { ok: false, declined: true, error: 'the codes were not confirmed on this app' } };
      await store.confirmLink(taken.linkId);
      return { status: 200, json: { ok: true, linkId: taken.linkId, sas: taken.sas, confirmed: true } };
    }
    if (type === 'DELEGATION_GRANT') {
      const read = delegation.readGrant(frame, { now: settings.now() });
      if (!read.ok) return { status: 400, json: { ok: false, error: read.error } };
      if (!read.grant.extensionOrigin || read.grant.extensionOrigin !== origin) {
        return { status: 403, json: { ok: false, error: 'the grant must name the extension origin it comes from' } };
      }
      const links = await store.links();
      const link = links.find((l) => l.status === 'confirmed' && l.revealHash && l.revealHash === read.grant.link && l.peer === read.author);
      const known = (await store.grants('given')).some((g) => g.grant.grantee.slice(2) === read.author);
      if (!link && !known) return { status: 403, json: { ok: false, error: 'pair with this app first' } };
      const taken = await store.receive(frame);
      if (!taken.ok) return { status: 400, json: { ok: false, error: taken.error } };
      let grants = [];
      if (link) {
        grants = await issueGrants({ linkId: link.linkId, revealHash: link.revealHash, peerPubkey: read.grant.grantor, peerLabel: link.peerLabel }, origin);
      }
      return { status: 200, json: { ok: true, grant: taken.hash, grants } };
    }
    if (type === 'DELEGATION_REVOKE') {
      const taken = await store.receive(frame);
      if (!taken.ok) return { status: 400, json: { ok: false, error: taken.error } };
      return { status: 200, json: { ok: true, revoked: taken.grant } };
    }
    return { status: 400, json: { ok: false, error: type ? `${type} does not belong on a link` : 'not a delegation frame' } };
  }

  async function buildAnswer (item) {
    const read = item.read;
    if (read.scope === 'passport') {
      const network = read.inner.network || settings.network;
      const account = accountFor(network, read.request.account);
      if (!account) return { error: 'locked' };
      if (account.identity.key.pubkey.slice(2) !== String(store.pubkey || '').slice(2)) return { error: `this app signs in on ${settings.network} only` };
      if (read.request.disclose.includes('wallet') && !account.wallet) return { error: 'no wallet keys to share' };
      if (read.request.disclose.includes('cosigner') && !(account.cosigner && account.cosigner.key)) return { error: 'no cosigner key to share' };
      const signed = delegation.answerPassport(read, {
        signer: settings.signer,
        network,
        wallet: account.wallet,
        cosignerKey: account.cosigner && account.cosigner.key,
        now: settings.now()
      }, account.identity.key);
      return { frame: signed.uri };
    }
    const account = accountFor(settings.network);
    if (!account) return { error: 'locked' };
    if (read.scope === 'message') return { frame: delegation.answerMessage(read, account.identity.key) };
    if (typeof settings.answer === 'function') {
      const frame = await settings.answer(item, account);
      return frame ? { frame } : { error: `this app does not answer ${read.scope} requests here` };
    }
    return { error: `this app does not answer ${read.scope} requests here` };
  }

  async function settled (hash) {
    const item = await store.inboxItem(hash);
    if (!item) return { status: 404, json: { ok: false, error: 'unknown request' } };
    if (item.status === 'pending') return { status: 202, json: { ok: true, status: 'pending', request: hash } };
    return { status: 200, json: { ok: true, status: item.status, request: hash, result: item.result ? encodeFabricUri(Buffer.from(item.result, 'hex')) : null } };
  }

  /**
   * Answer a pending request as a decision says; `notify` leaves it pending.
   * @private
   */
  async function settle (item, decision) {
    if (decision.action === 'decline') {
      await store.decline(item.hash, decision.reason || 'declined', { rule: decision.rule });
      return settled(item.hash);
    }
    if (decision.action === 'sign') {
      if (settings.now() >= item.read.request.expiresAt) return { status: 410, json: { ok: false, error: 'the request expired while waiting' } };
      let built;
      try {
        built = await buildAnswer(item);
      } catch (err) {
        built = { error: err.message };
      }
      if (built.error === 'locked') return { status: 503, json: { ok: false, locked: true, status: 'pending', request: item.hash, error: 'this app is locked' } };
      if (built.error) {
        await store.decline(item.hash, built.error, { rule: decision.rule });
        return settled(item.hash);
      }
      await store.sign(item.hash, built.frame, { rule: decision.rule });
      return settled(item.hash);
    }
    return settled(item.hash);
  }

  /** @private */
  async function decideAndSettle (item) {
    let decision = { action: 'notify' };
    if (typeof settings.decide === 'function') {
      try {
        decision = normalizeDecision(await settings.decide(item));
      } catch (_) {
        decision = { action: 'notify' };
      }
    }
    return settle(item, decision);
  }

  /**
   * Take a `DELEGATION_REQUEST` from Passport and answer it as `decide` says.
   * @param {string} frame
   * @param {string} origin
   * @returns {Promise<{ status: number, json: object }>}
   */
  async function takeRequest (frame, origin) {
    const decoded = decodeFabricUri(frame, { allowUnsigned: true, allowUnknownTypes: true });
    if (!decoded.ok) return { status: 400, json: { ok: false, error: decoded.error || 'unreadable frame' } };
    if (decoded.type !== 'DELEGATION_REQUEST') return { status: 426, json: Object.assign({ ok: false }, PASSPORT_OUTDATED) };
    const read = delegation.readRequest(frame, { now: settings.now() });
    if (!read.ok) return { status: 400, json: { ok: false, error: read.error } };
    const origins = await grantOrigins(read.request.requester);
    if (!origins.has(origin) && !configured.has(origin)) {
      return { status: 403, json: { ok: false, error: 'this extension holds no grant here' } };
    }
    const taken = await store.receive(frame);
    if (!taken.ok) return { status: 403, json: { ok: false, error: taken.error } };
    if (taken.duplicate) return settled(taken.hash);
    return decideAndSettle({ hash: taken.hash, scope: read.scope, read, grant: read.request.grant, notification: taken.notification, origin });
  }

  /**
   * Take a delegation frame that came another way (a mailbox, the mesh): the
   * grant check in `Delegation#receive` is the only gate. Requests go
   * through `decide` like loopback ones, with no `origin`.
   * @param {string|Buffer} frame
   * @returns {Promise<{ status: number, json: object }>}
   */
  async function takeRemote (frame) {
    const taken = await store.receive(frame);
    if (!taken.ok) return { status: 403, json: { ok: false, error: taken.error } };
    if (taken.type !== 'DELEGATION_REQUEST') return { status: 200, json: taken };
    if (taken.duplicate) return settled(taken.hash);
    const read = delegation.readRequest(frame, { now: settings.now() });
    if (!read.ok) return { status: 400, json: { ok: false, error: read.error } };
    return decideAndSettle({ hash: taken.hash, scope: read.scope, read, grant: read.request.grant, notification: taken.notification, origin: null });
  }

  /**
   * Answer a pending request the app's user (or a rule) decided on later.
   * A request settled before comes back as it is, with `alreadySettled`.
   * @param {string} hash
   * @param {Object|string} decision `sign` | `decline`, or `{ action, reason, rule }`
   * @returns {Promise<{ status: number, json: object }>}
   */
  async function resolve (hash, decision) {
    const item = await store.inboxItem(String(hash || '').toLowerCase());
    if (!item || !item.read || !item.read.ok) return { status: 404, json: { ok: false, error: 'unknown request' } };
    if (item.status !== 'pending') {
      const out = await settled(item.hash);
      out.json.alreadySettled = true;
      return out;
    }
    const normalized = normalizeDecision(decision);
    if (normalized.action === 'notify') return settled(item.hash);
    return settle({ hash: item.hash, scope: item.read.scope, read: item.read, grant: item.read.request.grant, origin: null }, normalized);
  }

  /**
   * Status of a request taken earlier, for the extension origin that may ask.
   * @param {string} hash
   * @param {string} origin
   * @returns {Promise<{ status: number, json: object }>}
   */
  async function requestStatus (hash, origin) {
    const item = await store.inboxItem(String(hash || '').toLowerCase());
    if (!item || !item.read || !item.read.ok) return { status: 404, json: { ok: false, error: 'unknown request' } };
    const origins = await grantOrigins(item.read.request.requester);
    if (!origins.has(origin) && !configured.has(origin)) return { status: 404, json: { ok: false, error: 'unknown request' } };
    return settled(item.hash);
  }

  const failed = (res) => (err) => sendJson(res, 500, { ok: false, error: (err && err.message) || 'delegate failed' });

  /**
   * Plain `http` router hook. Returns true when it answered.
   * @param {import('http').IncomingMessage} req
   * @param {import('http').ServerResponse} res
   * @param {string} [pathname]
   * @returns {boolean}
   */
  function handle (req, res, pathname) {
    let url;
    try { url = new URL(req.url || '/', 'http://localhost'); } catch (_) { return false; }
    const path = pathname || url.pathname;
    const method = String(req.method || 'GET').toUpperCase();
    if (path === DELEGATE_PATH && method === 'GET') {
      const checked = checkDelegateCaller(req, { allowNoOrigin: true });
      if (!checked.ok) { sendJson(res, checked.status, { ok: false, error: checked.error }); return true; }
      describe({ pubkey: url.searchParams.get('pubkey'), origin: checked.origin })
        .then((out) => sendJson(res, 200, out), failed(res));
      return true;
    }
    const isLinks = path === DELEGATE_LINKS_PATH && method === 'POST';
    const isRequest = path === DELEGATE_REQUESTS_PATH && method === 'POST';
    const statusMatch = method === 'GET' && path.startsWith(`${DELEGATE_REQUESTS_PATH}/`) ? /^[0-9a-f]{64}$/.exec(path.slice(DELEGATE_REQUESTS_PATH.length + 1)) : null;
    if (!isLinks && !isRequest && !statusMatch) return false;
    const checked = checkDelegateCaller(req);
    if (!checked.ok) { sendJson(res, checked.status, { ok: false, error: checked.error }); return true; }
    const run = async () => {
      if (statusMatch) return requestStatus(statusMatch[0], checked.origin);
      const { frame } = await readFrame(req);
      if (!frame) return { status: 400, json: { ok: false, error: 'frame required' } };
      return isLinks ? takeLinkFrame(frame, checked.origin) : takeRequest(frame, checked.origin);
    };
    run().then((out) => sendJson(res, out.status, out.json), (err) => sendJson(res, err.status || 500, { ok: false, error: err.message || 'delegate failed' }));
    return true;
  }

  /**
   * Mount on an Express app (or `HTTPServer#express`).
   * @param {Object} app
   */
  function mount (app) {
    const route = (req, res, next) => { if (!handle(req, res, req.path)) next(); };
    app.get(DELEGATE_PATH, route);
    app.post(DELEGATE_LINKS_PATH, route);
    app.post(DELEGATE_REQUESTS_PATH, route);
    app.get(`${DELEGATE_REQUESTS_PATH}/:hash`, route);
  }

  return { describe, takeLinkFrame, takeRequest, takeRemote, resolve, requestStatus, handle, mount };
}

module.exports = {
  DELEGATE_PATH,
  DELEGATE_LINKS_PATH,
  DELEGATE_REQUESTS_PATH,
  LINK_PROMPT_INTERVAL_MS,
  checkDelegateCaller,
  createFabricDelegate
};
