'use strict';

/**
 * @fileoverview Delegation transports over HTTP.
 *
 * Pairing rendezvous ({@link createDelegationRendezvous}): `/delegations`
 * relays the frames of a delegation link (`DELEGATION_LINK_OFFER` → `ANSWER` → `REVEAL`, then the
 * `DELEGATION_GRANT`s the two participants make each other) between two
 * participants that cannot reach each other directly. It holds frames only:
 * each is checked with `@fabric/core/types/delegation` and must follow
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
 *
 * Delegation mailbox ({@link createDelegationMailbox}): holds
 * `DELEGATION_REQUEST`, `RESULT`, `GRANT`, and `REVOKE` frames for a participant that is not online, keyed by
 * the pubkey each frame is for (`mailboxAddress` in
 * `@fabric/core/types/delegation`). Anyone may post a signed frame; only
 * the addressee reads it back, by presenting a fresh
 * `DELEGATION_MAILBOX_FETCH` signed by its key (each nonce works once). A
 * fetch's `since` acknowledges every frame up to it, and those are dropped so
 * the addressee frees its slots. Space is shared by sender (a client
 * address, an IPv6 host by its /64): one sender holds at most a quarter of a
 * key's slots (its own oldest non-revoke frame goes first), and a full box
 * drops the newest frame of the sender holding the most (on a tie, the sender
 * heard from last), and a revoke only when the box holds nothing else, so a
 * flood of new senders cannot push out a revoke already queued. Across keys,
 * one sender opens at most a sixteenth of `maxAddresses` boxes; a full table
 * drops the newest box that only the sender holding the most boxes wrote to
 * (never one holding a revoke), and a post is refused for space only when no
 * such box exists. Posts and fetches run one at a time, each with its write.
 * Senders are kept as keyed hashes, never addresses. The mailbox is a
 * courier: recipients check every frame themselves.
 *
 * Routes:
 * - `POST /services/delegation/mailbox { frame, to? }` (`to` is needed for
 *   results and revokes, which do not name their recipient).
 * - `GET /services/delegation/mailbox` with `X-Fabric-Mailbox: fabric:<fetch>`;
 *   returns frames after the fetch's `since` sequence number.
 */

const crypto = require('crypto');
const delegation = require('@fabric/core/types/delegation');
const { encodeFabricUri } = require('@fabric/core/functions/fabricUri');
const { normalizeHubOrigin } = require('./fabricHubAllowlist');
const { readFrame, sendJson, clientKey, clientGroup, createRateLimit } = require('./httpRequestTrust');

const DELEGATION_RENDEZVOUS_PATH = '/delegations';
const MAILBOX_HEADER = 'x-fabric-mailbox';
const DEFAULT_RETAIN_MS = 10 * 60 * 1000;
const DEFAULT_MAX_LINKS = 256;
const DEFAULT_MAX_PER_AUTHOR = 8;
const MAX_GRANTS_PER_LINK = 8;
const LINK_ID = /^[0-9a-f]{64}$/;
const DELEGATION_MAILBOX_PATH = '/services/delegation/mailbox';
const DEFAULT_MAX_PER_ADDRESS = 200;
const DEFAULT_MAX_ADDRESSES = 4096;
const MAILBOX_RETAIN_MS = 7 * 24 * 60 * 60 * 1000;
const DEFAULT_POSTS_PER_MINUTE = 60;
const DEFAULT_FETCH_LIMIT = 100;
/**
 * `DELEGATION_MAILBOX_FETCH` nonces already spent in this process: nonce →
 * expiresAt. One set for every rendezvous and mailbox, so a proof spent on one
 * route (a mailbox read, a pairing cancel) is refused on the others.
 */
const processSpentProofs = new Map();

/**
 * @param {Object} [options]
 * @param {string[]} [options.origins] Origins this rendezvous answers for; an offer naming another is refused. Any when omitted.
 * @param {Function} [options.now]
 * @param {number} [options.retainMs]
 * @param {number} [options.maxLinks]
 * @param {number} [options.maxPerAuthor]
 * @param {(boolean|string|string[])} [options.trustProxy] Rate-limit by the last `X-Forwarded-For` hop from a trusted proxy (`isTrustedProxy`).
 * @param {Map} [options.spentNonces] Spent mailbox proofs (default: one set per process, shared with the mailbox).
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
  const spentNonces = options.spentNonces instanceof Map ? options.spentNonces : processSpentProofs;
  const limit = createRateLimit({ limit: 60, windowMs: 60 * 1000, now });
  const readLimit = createRateLimit({ limit: 360, windowMs: 60 * 1000, now });
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
    if (!(method === 'GET' ? readLimit : limit)(clientKey(req, options.trustProxy))) {
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

/**
 * @param {Object} [options]
 * @param {Function} [options.now]
 * @param {number} [options.maxPerAddress]
 * @param {number} [options.maxAddresses]
 * @param {number} [options.retainMs] How long grants, revokes, and results are kept.
 * @param {number} [options.postsPerMinute] Per client address; fetches get six times that.
 * @param {(boolean|string|string[])} [options.trustProxy]
 * @param {Object} [options.store] `{ get(key), set(key, value) }` (async, JSON string) to survive restarts.
 * @param {string} [options.storeKey='delegation-mailbox']
 * @param {Map} [options.spentNonces] Spent mailbox proofs (default: one set per process, shared with the rendezvous).
 * @param {function(string, Buffer, object): (boolean|Promise<boolean>)} [options.deliver] Called with `(to, frame, read)` first; return true to take the frame instead of queueing it (the host's own participant).
 * @returns {Object} `{ post, fetch, load, handle, mount, mountOnHub }`
 */
function createDelegationMailbox (options = {}) {
  const now = typeof options.now === 'function' ? options.now : () => Date.now();
  const maxPerAddress = Number(options.maxPerAddress) > 0 ? Number(options.maxPerAddress) : DEFAULT_MAX_PER_ADDRESS;
  const maxAddresses = Number(options.maxAddresses) > 0 ? Number(options.maxAddresses) : DEFAULT_MAX_ADDRESSES;
  const retainMs = Number(options.retainMs) > 0 ? Number(options.retainMs) : MAILBOX_RETAIN_MS;
  const storeKey = options.storeKey || 'delegation-mailbox';
  const maxPerSender = Math.ceil(maxPerAddress / 4);
  const maxAddressesPerSender = Math.ceil(maxAddresses / 16);
  const postsPerMinute = Number(options.postsPerMinute) > 0 ? Number(options.postsPerMinute) : DEFAULT_POSTS_PER_MINUTE;
  const limit = createRateLimit({ limit: postsPerMinute, windowMs: 60 * 1000, now });
  const fetchLimit = createRateLimit({ limit: 6 * postsPerMinute, windowMs: 60 * 1000, now });
  const boxes = new Map();
  const spent = options.spentNonces instanceof Map ? options.spentNonces : processSpentProofs;
  let seq = 0;
  let secret = options.store ? null : crypto.randomBytes(32);
  let loaded = !options.store;
  let loading = null;
  let saving = Promise.resolve();
  let turn = Promise.resolve();

  /** Run `fn` after every earlier post or fetch has written (or rolled back). */
  function exclusive (fn) {
    const run = turn.then(fn, fn);
    turn = run.catch(() => {});
    return run;
  }

  function senderOf (address) {
    if (!address) return undefined;
    return crypto.createHmac('sha256', secret).update(clientGroup(address)).digest('hex').slice(0, 32);
  }

  async function load () {
    if (loaded) return;
    if (!loading) loading = hydrate();
    return loading;
  }

  async function hydrate () {
    try {
      const raw = await options.store.get(storeKey);
      const doc = raw ? JSON.parse(raw) : null;
      secret = doc && /^[0-9a-f]{64}$/.test(String(doc.secret)) ? Buffer.from(doc.secret, 'hex') : crypto.randomBytes(32);
      if (doc && doc.boxes) {
        seq = Math.max(seq, Number(doc.seq) || 0);
        for (const [to, items] of Object.entries(doc.boxes)) {
          if (!boxes.has(to)) boxes.set(to, items.map((i) => Object.assign({}, i, { buffer: Buffer.from(i.hex, 'hex') })));
        }
      }
      if (doc && doc.spent) {
        for (const [nonce, until] of Object.entries(doc.spent)) {
          if (!spent.has(nonce)) spent.set(nonce, Number(until) || 0);
        }
      }
      loaded = true;
    } catch (err) {
      throw Object.assign(new Error('mailbox unavailable'), { status: 503, cause: err });
    } finally {
      loading = null;
    }
  }

  function save () {
    if (!options.store || !loaded) return Promise.resolve();
    const doc = { seq, secret: secret.toString('hex'), boxes: {}, spent: {} };
    for (const [to, items] of boxes) doc.boxes[to] = items.map((i) => ({ seq: i.seq, hash: i.hash, type: i.type, hex: i.buffer.toString('hex'), at: i.at, until: i.until, from: i.from }));
    for (const [nonce, until] of spent) doc.spent[nonce] = until;
    const write = saving.then(() => options.store.set(storeKey, JSON.stringify(doc)));
    saving = write.catch(() => {});
    return write.catch((err) => {
      throw Object.assign(new Error('mailbox unavailable'), { status: 503, cause: err });
    });
  }

  function sweep () {
    const t = now();
    for (const [to, items] of boxes) {
      const live = items.filter((i) => i.until > t);
      if (!live.length) boxes.delete(to);
      else if (live.length !== items.length) boxes.set(to, live);
    }
    for (const [nonce, until] of spent) if (until <= t) spent.delete(nonce);
  }

  function evictionFor (items) {
    const others = items.filter((i) => i.type !== 'DELEGATION_REVOKE');
    const pool = others.length ? others : items;
    const held = new Map();
    for (const item of pool) {
      const key = item.from || '';
      if (!held.has(key)) held.set(key, { count: 0, newest: item });
      const entry = held.get(key);
      entry.count++;
      if (item.seq > entry.newest.seq) entry.newest = item;
    }
    let pick = null;
    for (const entry of held.values()) {
      if (!pick || entry.count > pick.count || (entry.count === pick.count && entry.newest.seq > pick.newest.seq)) pick = entry;
    }
    return pick.newest;
  }

  /** Boxes each sender has written to. */
  function boxesBySender () {
    const held = new Map();
    for (const [to, items] of boxes) {
      for (const from of new Set(items.map((i) => i.from || ''))) {
        if (!held.has(from)) held.set(from, []);
        held.get(from).push(to);
      }
    }
    return held;
  }

  /** A box to drop for a new one: the newest that only the busiest sender wrote to, holding no revoke. */
  function boxEvictionFor (held) {
    const ranked = [...held.entries()].sort((a, b) => b[1].length - a[1].length);
    for (const [from, addresses] of ranked) {
      let pick = null;
      for (const to of addresses) {
        const items = boxes.get(to);
        if (items.some((i) => (i.from || '') !== from || i.type === 'DELEGATION_REVOKE')) continue;
        const newest = Math.max(...items.map((i) => i.seq));
        if (!pick || newest > pick.newest) pick = { to, newest };
      }
      if (pick) return pick.to;
    }
    return null;
  }

  function readAddressed (type, buffer) {
    const opts = { now: now() };
    switch (type) {
      case 'DELEGATION_REQUEST': return delegation.readRequest(buffer, opts);
      case 'DELEGATION_RESULT': return delegation.readResult(buffer, opts);
      case 'DELEGATION_GRANT': return delegation.readGrant(buffer, opts);
      case 'DELEGATION_REVOKE': return delegation.readRevoke(buffer, opts);
      default: return { ok: false, error: 'not a mailbox frame' };
    }
  }

  function lifetime (type, buffer) {
    if (type === 'DELEGATION_REQUEST') {
      const read = delegation.readRequest(buffer, { now: now() });
      return read.ok ? read.request.expiresAt : 0;
    }
    return now() + retainMs;
  }

  /**
   * Queue a frame for its addressee.
   * @param {string|Buffer} frame
   * @param {{ to: (string|undefined), from: (string|undefined) }} [hints] `from` is the poster's client address.
   * @returns {Promise<{ status: number, body: object }>}
   */
  async function post (frame, hints = {}) {
    await load();
    const addressed = delegation.mailboxAddress(frame, hints);
    if (!addressed.ok) return { status: 400, body: { ok: false, error: addressed.error } };
    const read = readAddressed(addressed.type, addressed.buffer);
    if (!read.ok) return { status: 400, body: { ok: false, error: read.error } };
    const to = delegation.xOnly(addressed.to);
    if (typeof options.deliver === 'function') {
      const taken = await options.deliver(to, addressed.buffer, read);
      if (taken) return { status: 202, body: { ok: true, delivered: true, hash: addressed.hash } };
    }
    return exclusive(() => enqueue(to, addressed, hints));
  }

  /** @private one post's change to `to`'s box, kept only once written. */
  async function enqueue (to, addressed, hints) {
    sweep();
    const previous = boxes.get(to);
    const items = previous ? previous.slice() : [];
    if (items.some((i) => i.hash === addressed.hash)) return { status: 200, body: { ok: true, hash: addressed.hash, duplicate: true } };
    const until = lifetime(addressed.type, addressed.buffer);
    if (until <= now()) return { status: 400, body: { ok: false, error: 'frame expired' } };
    const from = senderOf(hints.from);
    let dropped = null;
    if (!previous) {
      const held = boxesBySender();
      if (from && (held.get(from) || []).length >= maxAddressesPerSender) {
        return { status: 429, body: { ok: false, error: 'too many mailboxes from this client' } };
      }
      if (boxes.size >= maxAddresses) {
        const victim = boxEvictionFor(held);
        if (!victim) return { status: 503, body: { ok: false, error: 'mailbox full' } };
        dropped = { to: victim, items: boxes.get(victim) };
        boxes.delete(victim);
      }
    }
    const own = from ? items.filter((i) => i.from === from) : [];
    if (own.length >= maxPerSender) {
      const mine = own.filter((i) => i.type !== 'DELEGATION_REVOKE');
      items.splice(items.indexOf(mine.length ? mine[0] : own[0]), 1);
    } else if (items.length >= maxPerAddress) items.splice(items.indexOf(evictionFor(items)), 1);
    const before = seq;
    seq++;
    items.push({ seq, hash: addressed.hash, type: addressed.type, buffer: addressed.buffer, at: now(), until, from });
    boxes.set(to, items);
    try {
      await save();
    } catch (err) {
      // Nothing else ran since this post began, so its snapshot is still current.
      if (previous) boxes.set(to, previous);
      else boxes.delete(to);
      if (dropped) boxes.set(dropped.to, dropped.items);
      seq = before;
      throw err;
    }
    return { status: 201, body: { ok: true, hash: addressed.hash, seq } };
  }

  /**
   * Frames for the key that signed `proof` (a `DELEGATION_MAILBOX_FETCH`).
   * @param {string} proof
   * @param {{ limit: (number|undefined) }} [params]
   * @returns {Promise<{ status: number, body: object }>}
   */
  async function fetchFrames (proof, params = {}) {
    await load();
    const read = delegation.readMailboxFetch(proof, { now: now() });
    if (!read.ok) return { status: 401, body: { ok: false, error: read.error } };
    return exclusive(() => drain(read, params));
  }

  /** @private */
  async function drain (read, params) {
    if (spent.has(read.nonce)) return { status: 409, body: { ok: false, error: 'fetch already used' } };
    sweep();
    spent.set(read.nonce, read.expiresAt);
    const to = delegation.xOnly(read.pubkey);
    const unread = (boxes.get(to) || []).filter((i) => i.seq > read.since);
    if (unread.length) boxes.set(to, unread);
    else boxes.delete(to);
    await save();
    const max = Math.min(DEFAULT_FETCH_LIMIT, Math.max(1, Number(params.limit) || DEFAULT_FETCH_LIMIT));
    const items = unread.slice(0, max);
    const next = items.length ? items[items.length - 1].seq : read.since;
    return {
      status: 200,
      body: { ok: true, frames: items.map((i) => ({ seq: i.seq, type: i.type, hash: i.hash, frame: encodeFabricUri(i.buffer), at: i.at })), next }
    };
  }

  /**
   * @param {import('http').IncomingMessage} req
   * @param {import('http').ServerResponse} res
   * @returns {Promise<boolean>}
   */
  async function handle (req, res) {
    let url = null;
    try { url = new URL(req.url || '/', 'http://localhost'); } catch (_) { return false; }
    if (url.pathname !== DELEGATION_MAILBOX_PATH) return false;
    const method = String(req.method || 'GET').toUpperCase();
    try {
      let out;
      const address = clientKey(req, options.trustProxy);
      if (!(method === 'GET' ? fetchLimit : limit)(address)) {
        sendJson(res, 429, { ok: false, error: 'slow down' });
        return true;
      }
      if (method === 'POST') {
        const { frame, body } = await readFrame(req);
        out = frame ? await post(frame, { to: typeof body.to === 'string' ? body.to : undefined, from: address }) : { status: 400, body: { ok: false, error: 'frame required' } };
      } else if (method === 'GET') {
        const proof = String((req.headers && req.headers[MAILBOX_HEADER]) || '').trim();
        out = proof ? await fetchFrames(proof, { limit: url.searchParams.get('limit') }) : { status: 401, body: { ok: false, error: `${MAILBOX_HEADER} required` } };
      } else {
        out = { status: 405, body: { ok: false, error: 'method not allowed' } };
      }
      sendJson(res, out.status, out.body);
    } catch (err) {
      sendJson(res, err.status || 400, { ok: false, error: err.message || 'bad request' });
    }
    return true;
  }

  /** @param {Object} app Express app. */
  function mount (app) {
    const route = (req, res, next) => { handle(req, res).then((done) => { if (!done) next(); }, next); };
    app.post(DELEGATION_MAILBOX_PATH, route);
    app.get(DELEGATION_MAILBOX_PATH, route);
  }

  /** @param {Object} hub Hub with `http._addRoute`. */
  function mountOnHub (hub) {
    if (!hub || !hub.http || typeof hub.http._addRoute !== 'function') return;
    const route = (req, res) => {
      handle(req, res).then((done) => {
        if (!done) sendJson(res, 404, { ok: false, error: 'not found' });
      }, (err) => sendJson(res, 500, { ok: false, error: err.message }));
    };
    hub.http._addRoute('POST', DELEGATION_MAILBOX_PATH, route);
    hub.http._addRoute('GET', DELEGATION_MAILBOX_PATH, route);
  }

  return { post, fetch: fetchFrames, load, handle, mount, mountOnHub };
}

module.exports = {
  DELEGATION_RENDEZVOUS_PATH,
  MAILBOX_HEADER,
  MAX_GRANTS_PER_LINK,
  DELEGATION_MAILBOX_PATH,
  createDelegationRendezvous,
  createDelegationMailbox
};
