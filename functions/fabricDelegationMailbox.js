'use strict';

/**
 * @fileoverview Delegation mailbox: holds `DELEGATION_REQUEST`, `RESULT`,
 * `GRANT`, and `REVOKE` frames for a participant that is not online, keyed by
 * the pubkey each frame is for (`mailboxAddress` in
 * `@fabric/core/functions/delegation`). Anyone may post a signed frame; only
 * the addressee reads it back, by presenting a fresh
 * `DELEGATION_MAILBOX_FETCH` signed by its key (each nonce works once). The
 * mailbox is a courier: recipients check every frame themselves.
 *
 * Routes:
 * - `POST /services/delegation/mailbox { frame, to? }` (`to` is needed for
 *   results and revokes, which do not name their recipient).
 * - `GET /services/delegation/mailbox` with `X-Fabric-Mailbox: fabric:<fetch>`;
 *   returns frames after the fetch's `since` sequence number.
 */

const delegation = require('@fabric/core/functions/delegation');
const { encodeFabricUri } = require('@fabric/core/functions/fabricUri');
const { readFrame, sendJson, clientAddress, createRateLimit } = require('./delegationHttpBody');

const DELEGATION_MAILBOX_PATH = '/services/delegation/mailbox';
const MAILBOX_HEADER = 'x-fabric-mailbox';
const DEFAULT_MAX_PER_ADDRESS = 200;
const DEFAULT_MAX_ADDRESSES = 4096;
const DEFAULT_RETAIN_MS = 7 * 24 * 60 * 60 * 1000;
const DEFAULT_POSTS_PER_MINUTE = 60;
const DEFAULT_FETCH_LIMIT = 100;

/**
 * @param {Object} [options]
 * @param {Function} [options.now]
 * @param {number} [options.maxPerAddress]
 * @param {number} [options.maxAddresses]
 * @param {number} [options.retainMs] How long grants, revokes, and results are kept.
 * @param {number} [options.postsPerMinute] Per client address.
 * @param {boolean} [options.trustProxy]
 * @param {Object} [options.store] `{ get(key), set(key, value) }` (async, JSON string) to survive restarts.
 * @param {string} [options.storeKey='delegation-mailbox']
 * @param {function(string, Buffer, object): (boolean|Promise<boolean>)} [options.deliver] Called with `(to, frame, read)` first; return true to take the frame instead of queueing it (the host's own participant).
 * @returns {Object} `{ post, fetch, load, handle, mount, mountOnHub }`
 */
function createDelegationMailbox (options = {}) {
  const now = typeof options.now === 'function' ? options.now : () => Date.now();
  const maxPerAddress = Number(options.maxPerAddress) > 0 ? Number(options.maxPerAddress) : DEFAULT_MAX_PER_ADDRESS;
  const maxAddresses = Number(options.maxAddresses) > 0 ? Number(options.maxAddresses) : DEFAULT_MAX_ADDRESSES;
  const retainMs = Number(options.retainMs) > 0 ? Number(options.retainMs) : DEFAULT_RETAIN_MS;
  const storeKey = options.storeKey || 'delegation-mailbox';
  const limit = createRateLimit({ limit: Number(options.postsPerMinute) > 0 ? Number(options.postsPerMinute) : DEFAULT_POSTS_PER_MINUTE, windowMs: 60 * 1000, now });
  const boxes = new Map();
  const spent = new Map();
  let seq = 0;
  let loaded = !options.store;
  let saving = Promise.resolve();

  async function load () {
    if (loaded) return;
    loaded = true;
    try {
      const raw = await options.store.get(storeKey);
      const doc = raw ? JSON.parse(raw) : null;
      if (doc && doc.boxes) {
        seq = Number(doc.seq) || 0;
        for (const [to, items] of Object.entries(doc.boxes)) {
          boxes.set(to, items.map((i) => Object.assign({}, i, { buffer: Buffer.from(i.hex, 'hex') })));
        }
      }
    } catch (_) {}
  }

  function save () {
    if (!options.store) return Promise.resolve();
    const doc = { seq, boxes: {} };
    for (const [to, items] of boxes) doc.boxes[to] = items.map((i) => ({ seq: i.seq, hash: i.hash, type: i.type, hex: i.buffer.toString('hex'), at: i.at, until: i.until }));
    saving = saving.then(() => options.store.set(storeKey, JSON.stringify(doc))).catch(() => {});
    return saving;
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
   * @param {{ to: (string|undefined) }} [hints]
   * @returns {Promise<{ status: number, body: object }>}
   */
  async function post (frame, hints = {}) {
    await load();
    sweep();
    const addressed = delegation.mailboxAddress(frame, hints);
    if (!addressed.ok) return { status: 400, body: { ok: false, error: addressed.error } };
    const checks = {
      DELEGATION_REQUEST: delegation.readRequest,
      DELEGATION_RESULT: delegation.readResult,
      DELEGATION_GRANT: delegation.readGrant,
      DELEGATION_REVOKE: delegation.readRevoke
    };
    const read = checks[addressed.type](addressed.buffer, { now: now() });
    if (!read.ok) return { status: 400, body: { ok: false, error: read.error } };
    const to = delegation.xOnly(addressed.to);
    if (typeof options.deliver === 'function') {
      const taken = await options.deliver(to, addressed.buffer, read);
      if (taken) return { status: 202, body: { ok: true, delivered: true, hash: addressed.hash } };
    }
    const items = boxes.get(to) || [];
    if (items.some((i) => i.hash === addressed.hash)) return { status: 200, body: { ok: true, hash: addressed.hash, duplicate: true } };
    if (!boxes.has(to) && boxes.size >= maxAddresses) return { status: 503, body: { ok: false, error: 'mailbox full' } };
    if (items.length >= maxPerAddress) return { status: 429, body: { ok: false, error: 'mailbox full for that key' } };
    const until = lifetime(addressed.type, addressed.buffer);
    if (until <= now()) return { status: 400, body: { ok: false, error: 'frame expired' } };
    seq++;
    items.push({ seq, hash: addressed.hash, type: addressed.type, buffer: addressed.buffer, at: now(), until });
    boxes.set(to, items);
    await save();
    return { status: 201, body: { ok: true, hash: addressed.hash, seq } };
  }

  /**
   * Frames for the key that signed `proof` (a `DELEGATION_MAILBOX_FETCH`).
   * @param {string} proof
   * @param {{ limit: (number|undefined) }} [params]
   * @returns {Promise<{ status: number, body: object }>}
   */
  async function fetch (proof, params = {}) {
    await load();
    sweep();
    const read = delegation.readMailboxFetch(proof, { now: now() });
    if (!read.ok) return { status: 401, body: { ok: false, error: read.error } };
    if (spent.has(read.nonce)) return { status: 409, body: { ok: false, error: 'fetch already used' } };
    spent.set(read.nonce, read.expiresAt);
    const to = delegation.xOnly(read.pubkey);
    const max = Math.min(DEFAULT_FETCH_LIMIT, Math.max(1, Number(params.limit) || DEFAULT_FETCH_LIMIT));
    const items = (boxes.get(to) || []).filter((i) => i.seq > read.since).slice(0, max);
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
      if (method === 'POST') {
        if (!limit(clientAddress(req, options.trustProxy))) {
          sendJson(res, 429, { ok: false, error: 'slow down' });
          return true;
        }
        const { frame, body } = await readFrame(req);
        out = frame ? await post(frame, { to: typeof body.to === 'string' ? body.to : undefined }) : { status: 400, body: { ok: false, error: 'frame required' } };
      } else if (method === 'GET') {
        const proof = String((req.headers && req.headers[MAILBOX_HEADER]) || '').trim();
        out = proof ? await fetch(proof, { limit: url.searchParams.get('limit') }) : { status: 401, body: { ok: false, error: `${MAILBOX_HEADER} required` } };
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

  return { post, fetch, load, handle, mount, mountOnHub };
}

module.exports = {
  DELEGATION_MAILBOX_PATH,
  MAILBOX_HEADER,
  createDelegationMailbox
};
