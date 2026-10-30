'use strict';

/**
 * @fileoverview Pairing rendezvous: `/delegations` relays the frames of a
 * delegation link (`DELEGATION_LINK_OFFER` → `ANSWER` → `REVEAL`, then the
 * `DELEGATION_GRANT`s the two participants make each other) between two
 * participants that cannot reach each other directly. It holds frames only:
 * each is checked with `@fabric/core/functions/delegation` and must follow
 * the previous one, so a rendezvous can drop or delay a pairing but cannot
 * forge one, and both screens show the code the frames commit to.
 *
 * Routes (JSON; frames as `fabric:` strings):
 * - `POST /delegations { frame }` an offer; the link id is the offer's frame hash.
 * - `POST /delegations/:id/frames { frame }` the next frame of that link.
 * - `GET /delegations/:id` the link's frames so far.
 * - `DELETE /delegations/:id` with a fresh `DELEGATION_MAILBOX_FETCH` from
 *   either participant in `X-Fabric-Mailbox` ends the link early.
 *
 * Links are kept `retainMs` (10 minutes) after the offer; at most `maxLinks`
 * at once and `maxPerAuthor` per offering key.
 */

const delegation = require('@fabric/core/functions/delegation');
const { encodeFabricUri } = require('@fabric/core/functions/fabricUri');
const { normalizeHubOrigin } = require('./fabricHubAllowlist');
const { readFrame, sendJson, clientAddress, createRateLimit } = require('./delegationHttpBody');

const DELEGATION_RENDEZVOUS_PATH = '/delegations';
const MAILBOX_HEADER = 'x-fabric-mailbox';
const DEFAULT_RETAIN_MS = 10 * 60 * 1000;
const DEFAULT_MAX_LINKS = 256;
const DEFAULT_MAX_PER_AUTHOR = 8;
const MAX_GRANTS_PER_LINK = 8;
const LINK_ID = /^[0-9a-f]{64}$/;

/**
 * @param {Object} [options]
 * @param {string[]} [options.origins] Origins this rendezvous answers for; an offer naming another is refused. Any when omitted.
 * @param {Function} [options.now]
 * @param {number} [options.retainMs]
 * @param {number} [options.maxLinks]
 * @param {number} [options.maxPerAuthor]
 * @param {boolean} [options.trustProxy] Rate-limit by the last `X-Forwarded-For` hop.
 * @returns {Object} `{ create, append, read, cancel, size, handle, mount, mountOnHub }`
 */
function createDelegationRendezvous (options = {}) {
  const now = typeof options.now === 'function' ? options.now : () => Date.now();
  const retainMs = Number(options.retainMs) > 0 ? Number(options.retainMs) : DEFAULT_RETAIN_MS;
  const maxLinks = Number(options.maxLinks) > 0 ? Number(options.maxLinks) : DEFAULT_MAX_LINKS;
  const maxPerAuthor = Number(options.maxPerAuthor) > 0 ? Number(options.maxPerAuthor) : DEFAULT_MAX_PER_AUTHOR;
  const origins = Array.isArray(options.origins) && options.origins.length
    ? new Set(options.origins.map((o) => normalizeHubOrigin(o)).filter(Boolean))
    : null;
  const links = new Map();
  const spentNonces = new Map();
  const limit = createRateLimit({ limit: 60, windowMs: 60 * 1000, now });
  const opts = () => ({ now: now() });

  function sweep () {
    const t = now();
    for (const [id, link] of links) if (link.expiresAt <= t) links.delete(id);
    for (const [nonce, until] of spentNonces) if (until <= t) spentNonces.delete(nonce);
  }

  function view (id, link) {
    return {
      ok: true,
      id,
      status: link.reveal ? 'revealed' : (link.answer ? 'answered' : 'offered'),
      origin: link.origin,
      initiator: link.initiator,
      responder: link.responder || null,
      frames: link.frames.map((buf) => encodeFabricUri(buf)),
      expiresAt: link.expiresAt
    };
  }

  /**
   * Open a link with an offer.
   * @param {string|Buffer} frame
   * @returns {{ status: number, body: object }}
   */
  function create (frame) {
    sweep();
    const read = delegation.readLinkOffer(frame, opts());
    if (!read.ok) return { status: 400, body: { ok: false, error: read.error } };
    if (origins && !origins.has(normalizeHubOrigin(read.offer.origin))) {
      return { status: 403, body: { ok: false, error: 'the offer names another rendezvous' } };
    }
    if (links.has(read.linkId)) return { status: 409, body: { ok: false, error: 'link already open' } };
    if (links.size >= maxLinks) return { status: 503, body: { ok: false, error: 'too many open links' } };
    let mine = 0;
    for (const link of links.values()) if (link.initiator === read.author) mine++;
    if (mine >= maxPerAuthor) return { status: 429, body: { ok: false, error: 'too many open links for this key' } };
    const link = {
      origin: read.offer.origin,
      initiator: read.author,
      responder: null,
      offer: read.buffer,
      answer: null,
      reveal: null,
      grants: 0,
      seen: new Set([read.linkId]),
      frames: [read.buffer],
      expiresAt: now() + retainMs
    };
    links.set(read.linkId, link);
    return { status: 201, body: view(read.linkId, link) };
  }

  /**
   * Add the next frame of a link.
   * @param {string} id
   * @param {string|Buffer} frame
   * @returns {{ status: number, body: object }}
   */
  function append (id, frame) {
    sweep();
    const link = links.get(String(id || '').toLowerCase());
    if (!link) return { status: 404, body: { ok: false, error: 'no such link' } };
    const type = delegation.delegationType(frame);
    if (type === 'DELEGATION_LINK_ANSWER') {
      if (link.answer) return { status: 409, body: { ok: false, error: 'already answered' } };
      const read = delegation.readLinkAnswer(frame, opts());
      if (!read.ok) return { status: 400, body: { ok: false, error: read.error } };
      if (read.answer.offer !== id) return { status: 400, body: { ok: false, error: 'the answer is for another offer' } };
      if (read.author === link.initiator) return { status: 400, body: { ok: false, error: 'a key cannot pair with itself' } };
      link.answer = read.buffer;
      link.responder = read.author;
      link.seen.add(read.hash);
      link.frames.push(read.buffer);
      return { status: 201, body: view(id, link) };
    }
    if (type === 'DELEGATION_LINK_REVEAL') {
      if (!link.answer) return { status: 409, body: { ok: false, error: 'not answered yet' } };
      if (link.reveal) return { status: 409, body: { ok: false, error: 'already revealed' } };
      const read = delegation.readLinkReveal(frame, opts());
      if (!read.ok) return { status: 400, body: { ok: false, error: read.error } };
      const checked = delegation.verifyLink({ offer: link.offer, answer: link.answer, reveal: read.buffer }, opts());
      if (!checked.ok) return { status: 400, body: { ok: false, error: checked.error } };
      link.reveal = read.buffer;
      link.revealHash = checked.revealHash;
      link.seen.add(read.hash);
      link.frames.push(read.buffer);
      return { status: 201, body: view(id, link) };
    }
    if (type === 'DELEGATION_GRANT') {
      if (!link.reveal) return { status: 409, body: { ok: false, error: 'pairing not finished' } };
      const read = delegation.readGrant(frame, opts());
      if (!read.ok) return { status: 400, body: { ok: false, error: read.error } };
      if (link.seen.has(read.hash)) return { status: 200, body: view(id, link) };
      const author = read.author;
      const grantee = read.grant.grantee.slice(2);
      const pair = (author === link.initiator && grantee === link.responder) || (author === link.responder && grantee === link.initiator);
      if (!pair) return { status: 403, body: { ok: false, error: 'the grant is not between this link\'s participants' } };
      if (read.grant.link && read.grant.link !== link.revealHash) return { status: 400, body: { ok: false, error: 'the grant names another pairing' } };
      if (link.grants >= MAX_GRANTS_PER_LINK) return { status: 429, body: { ok: false, error: 'too many grants on this link' } };
      link.grants++;
      link.seen.add(read.hash);
      link.frames.push(read.buffer);
      return { status: 201, body: view(id, link) };
    }
    return { status: 400, body: { ok: false, error: type ? `${type} does not belong on a link` : 'not a delegation frame' } };
  }

  /**
   * @param {string} id
   * @returns {{ status: number, body: object }}
   */
  function read (id) {
    sweep();
    const key = String(id || '').toLowerCase();
    const link = links.get(key);
    if (!link) return { status: 404, body: { ok: false, error: 'no such link' } };
    return { status: 200, body: view(key, link) };
  }

  /**
   * End a link early; `proof` is a fresh `DELEGATION_MAILBOX_FETCH` from either participant.
   * @param {string} id
   * @param {string} proof
   * @returns {{ status: number, body: object }}
   */
  function cancel (id, proof) {
    sweep();
    const key = String(id || '').toLowerCase();
    const link = links.get(key);
    if (!link) return { status: 404, body: { ok: false, error: 'no such link' } };
    const fetched = delegation.readMailboxFetch(proof, opts());
    if (!fetched.ok) return { status: 401, body: { ok: false, error: fetched.error } };
    const who = fetched.pubkey.slice(2);
    if (who !== link.initiator && who !== link.responder) return { status: 403, body: { ok: false, error: 'not a participant of this link' } };
    if (spentNonces.has(fetched.nonce)) return { status: 409, body: { ok: false, error: 'proof already used' } };
    spentNonces.set(fetched.nonce, fetched.expiresAt);
    links.delete(key);
    return { status: 200, body: { ok: true, id: key, cancelled: true } };
  }

  /**
   * Answer a request whose pathname is under {@link DELEGATION_RENDEZVOUS_PATH}.
   * @param {import('http').IncomingMessage} req
   * @param {import('http').ServerResponse} res
   * @returns {Promise<boolean>} Whether the request was for this rendezvous.
   */
  async function handle (req, res) {
    let pathname = '/';
    try { pathname = new URL(req.url || '/', 'http://localhost').pathname; } catch (_) {}
    const base = DELEGATION_RENDEZVOUS_PATH;
    if (pathname !== base && !pathname.startsWith(`${base}/`)) return false;
    const method = String(req.method || 'GET').toUpperCase();
    const rest = pathname.slice(base.length).split('/').filter(Boolean);
    const id = rest[0] ? String(rest[0]).toLowerCase() : '';
    if (id && !LINK_ID.test(id)) {
      sendJson(res, 404, { ok: false, error: 'no such link' });
      return true;
    }
    if (method !== 'GET' && !limit(clientAddress(req, options.trustProxy))) {
      sendJson(res, 429, { ok: false, error: 'slow down' });
      return true;
    }
    try {
      let out = null;
      if (!id && method === 'POST') {
        const { frame } = await readFrame(req);
        out = frame ? create(frame) : { status: 400, body: { ok: false, error: 'frame required' } };
      } else if (id && rest.length === 2 && rest[1] === 'frames' && method === 'POST') {
        const { frame } = await readFrame(req);
        out = frame ? append(id, frame) : { status: 400, body: { ok: false, error: 'frame required' } };
      } else if (id && rest.length === 1 && method === 'GET') {
        out = read(id);
      } else if (id && rest.length === 1 && method === 'DELETE') {
        out = cancel(id, String((req.headers && req.headers[MAILBOX_HEADER]) || '').trim());
      } else {
        out = { status: 405, body: { ok: false, error: 'method not allowed' } };
      }
      sendJson(res, out.status, out.body);
    } catch (err) {
      sendJson(res, err.status || 400, { ok: false, error: err.message || 'bad request' });
    }
    return true;
  }

  /**
   * Mount on an Express app.
   * @param {Object} app
   */
  function mount (app) {
    const route = (req, res, next) => { handle(req, res).then((done) => { if (!done) next(); }, next); };
    app.post(DELEGATION_RENDEZVOUS_PATH, route);
    app.post(`${DELEGATION_RENDEZVOUS_PATH}/:id/frames`, route);
    app.get(`${DELEGATION_RENDEZVOUS_PATH}/:id`, route);
    app.delete(`${DELEGATION_RENDEZVOUS_PATH}/:id`, route);
  }

  /**
   * Mount on a Hub (`hub.http._addRoute(method, path, handler)`).
   * @param {Object} hub
   */
  function mountOnHub (hub) {
    if (!hub || !hub.http || typeof hub.http._addRoute !== 'function') return;
    const route = (req, res) => {
      handle(req, res).then((done) => {
        if (!done) sendJson(res, 404, { ok: false, error: 'not found' });
      }, (err) => sendJson(res, 500, { ok: false, error: err.message }));
    };
    hub.http._addRoute('POST', DELEGATION_RENDEZVOUS_PATH, route);
    hub.http._addRoute('POST', `${DELEGATION_RENDEZVOUS_PATH}/:id/frames`, route);
    hub.http._addRoute('GET', `${DELEGATION_RENDEZVOUS_PATH}/:id`, route);
    hub.http._addRoute('DELETE', `${DELEGATION_RENDEZVOUS_PATH}/:id`, route);
  }

  return { create, append, read, cancel, size: () => { sweep(); return links.size; }, handle, mount, mountOnHub };
}

module.exports = {
  DELEGATION_RENDEZVOUS_PATH,
  MAILBOX_HEADER,
  MAX_GRANTS_PER_LINK,
  createDelegationRendezvous
};
