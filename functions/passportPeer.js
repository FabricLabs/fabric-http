'use strict';

/**
 * @fileoverview Passport peer sessions (v3), peer side: sign a user in to
 * this peer by its Fabric key, over a connection the user's signer opened.
 * No web origin is pinned; the peer's key is the audience.
 *
 * On one connection:
 * 1. `PASSPORT_CONNECT` (unsigned, fresh `clientNonce`) → a `PASSPORT_CHALLENGE`
 *    this peer signs, echoing the nonce. One pending challenge per connection.
 * 2. `PASSPORT_ASSERTION` naming this peer and a `sessionKey` → the challenge
 *    is spent, the assertion verified, and a signed `PASSPORT_SESSION` sent back.
 * 3. From then on, frames on that connection signed by `sessionKey` are the
 *    identity's ({@link callerOf}). A relay that forwards the handshake can't
 *    sign as the session key, so it can't speak for the user.
 * 4. `PASSPORT_RESUME`, signed by the session key over a fresh challenge,
 *    re-binds a live session on a new connection without asking the user.
 *
 * Anything refused is answered with `PASSPORT_REFUSED`. Transport-agnostic:
 * a connection is any object (a WebSocket, a WebRTC channel); hosts call
 * {@link handleFrame} with its frames and send the replies back on it.
 *
 * Over plain HTTP ({@link createPassportPeerHttp}), the handshake runs on
 * `POST /sessions/peer` with a binding the client sends back
 * (`X-Fabric-Binding`), and each later request carries a request
 * authorization signed by the session key in `X-Fabric-Request`
 * (`functions/passportPeerRequest`, {@link authorizeRequest}): bound to the
 * method, path and query, body, and a nonce used once.
 */

const crypto = require('crypto');
const passport = require('@fabric/core/functions/passport');
const Message = require('@fabric/core/types/message');
const { encodeFabricUri, decodeFabricUri } = require('@fabric/core/functions/fabricUri');
const { createMemoryStore, hashSecret } = require('./passportRelyingParty');
const { clientKey, createRateLimit, fabricUriFromBody } = require('./httpRequestTrust');
const { readPeerRequest, PASSPORT_REQUEST_CLOCK_SKEW_MS } = require('./passportPeerRequest');

/** Frames a peer answers. */
const PASSPORT_PEER_FRAME_TYPES = Object.freeze(['PASSPORT_CONNECT', 'PASSPORT_ASSERTION', 'PASSPORT_RESUME']);
/** Connects one connection may send per minute. */
const CONNECTS_PER_MINUTE = 30;
/** Sessions one connection may carry at once. */
const MAX_SESSIONS_PER_CONNECTION = 16;
/** Most live sessions the default in-memory store keeps. */
const MEMORY_SESSION_STORE_MAX = 100000;
/** Request header carrying a request authorization (`functions/passportPeerRequest`). */
const PASSPORT_REQUEST_HEADER = 'x-fabric-request';
/** Request header carrying an HTTP handshake's binding. */
const PASSPORT_BINDING_HEADER = 'x-fabric-binding';
/** How long an HTTP handshake may take between connect and assertion. */
const HTTP_HANDSHAKE_TTL_MS = 4 * 60 * 1000;
/** Most HTTP handshakes in flight. */
const MAX_HTTP_HANDSHAKES = 10000;
/** Most request nonces remembered (each until its request expires). */
const MAX_SEEN_REQUEST_NONCES = 200000;
/** Largest handshake body. */
const MAX_HANDSHAKE_BODY_BYTES = 64 * 1024;

/** @private */
function sha256Hex (buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

/** @private */
function toBuffer (input) {
  if (input instanceof Message) return input.toBuffer();
  if (Buffer.isBuffer(input)) return input;
  if (input instanceof Uint8Array || input instanceof ArrayBuffer) return Buffer.from(input);
  return null;
}

/** @private */
function frameType (buffer) {
  if (!buffer || buffer.length < 76) return null;
  return Message.canonicalTypeName(buffer.readUInt32BE(72));
}

/**
 * Whether a raw frame is one a Passport peer answers.
 * @param {Buffer|Uint8Array|Message} input
 * @returns {boolean}
 */
function isPassportPeerFrame (input) {
  return PASSPORT_PEER_FRAME_TYPES.includes(frameType(toBuffer(input)));
}

/**
 * Create the peer side.
 * @param {Object} settings
 * @param {object} settings.key This peer's identity Key (private); its pubkey is the audience.
 * @param {string} [settings.network] Network named in every challenge.
 * @param {string} [settings.purpose] Shown to the user.
 * @param {(string[]|function(): string[])} [settings.homes] Origins this peer serves (shown, never required).
 * @param {string[]} [settings.request] Disclosures always asked for, besides what the signer asks.
 * @param {string[]} [settings.signers] Accept only these signer labels.
 * @param {number} [settings.sessionTtlMs]
 * @param {object} [settings.sessionStore] `{ put, get, delete }` keyed by session id (default in-memory).
 * @param {function(object, object): Promise<(object|void)>} [settings.onSession] Called with the
 *   verified assertion and the connection before a session starts. Return extra session fields, or
 *   throw to refuse.
 * @param {function(): number} [settings.now]
 * @returns {object}
 */
function createPassportPeer (settings = {}) {
  const key = settings.key;
  if (!key || !key.private || typeof key.signSchnorrHash !== 'function') {
    throw new TypeError('Passport peer: a private identity key is required');
  }
  const peer = String(key.pubkey || '').toLowerCase();
  const now = typeof settings.now === 'function' ? settings.now : Date.now;
  const network = settings.network ? String(settings.network) : null;
  const signers = Array.isArray(settings.signers) ? settings.signers.slice() : null;
  const baseRequest = Array.isArray(settings.request) ? settings.request.slice() : [];
  const store = settings.sessionStore || createMemoryStore({ now, max: MEMORY_SESSION_STORE_MAX });
  const connections = new WeakMap();
  /** HTTP handshakes: sha256(binding) → `{ conn, expiresAt }`. */
  const handshakes = new Map();
  /** Request nonces already used: nonce → expiresAt. */
  const seenNonces = new Map();

  function homes () {
    const list = typeof settings.homes === 'function' ? settings.homes() : settings.homes;
    return Array.isArray(list) ? list : [];
  }

  function stateOf (conn) {
    let state = connections.get(conn);
    if (!state) {
      state = { challenge: null, sessions: new Map(), connects: [] };
      connections.set(conn, state);
    }
    return state;
  }

  function refuse (error, buffer) {
    const frame = passport.createRefusal({ error, answers: buffer, now: now() }, key);
    return { replies: [frame.message.toBuffer()], error };
  }

  /**
   * The public part of a session.
   * @param {object} record
   * @returns {object}
   */
  function sessionView (record) {
    if (!record) return null;
    const view = {
      sessionId: record.sessionId,
      identity: { id: record.identityId, pubkey: record.pubkey },
      peer,
      network: record.network,
      signer: record.signer,
      device: record.device || null,
      origin: record.origin || null,
      issuedAt: record.issuedAt,
      expiresAt: record.expiresAt
    };
    if (record.wallet) view.wallet = record.wallet;
    if (record.cosigner) view.cosigner = { pubkey: record.cosigner.pubkey };
    for (const [name, value] of Object.entries(record.extra || {})) {
      if (!(name in view)) view[name] = value;
    }
    return view;
  }

  function bind (state, record) {
    state.sessions.delete(record.sessionKey.slice(2));
    if (state.sessions.size >= MAX_SESSIONS_PER_CONNECTION) {
      const oldest = state.sessions.keys().next().value;
      state.sessions.delete(oldest);
    }
    state.sessions.set(record.sessionKey.slice(2), record.sessionId);
  }

  function onConnect (state, buffer) {
    const at = now();
    state.connects = state.connects.filter((t) => t > at - 60 * 1000);
    if (state.connects.length >= CONNECTS_PER_MINUTE) return refuse('slow down', buffer);
    state.connects.push(at);
    const read = passport.readConnect(buffer, { now: at });
    if (!read.ok) return refuse(read.error, buffer);
    if (read.connect.peer && read.connect.peer !== peer) return refuse('this is another peer', buffer);
    const request = passport.PASSPORT_DISCLOSURES.filter((d) => baseRequest.includes(d) || read.connect.request.includes(d));
    const challenge = passport.createPeerChallenge({
      clientNonce: read.connect.clientNonce,
      origin: read.connect.origin,
      homes: homes(),
      purpose: settings.purpose,
      network,
      request,
      now: at
    }, key);
    state.challenge = {
      nonce: challenge.nonce,
      hash: challenge.hash,
      expiresAt: challenge.expiresAt,
      network: challenge.network,
      request: challenge.request
    };
    return { replies: [challenge.message.toBuffer()] };
  }

  async function onAssertion (conn, state, buffer) {
    const pending = state.challenge;
    state.challenge = null;
    if (!pending) return refuse('no challenge on this connection', buffer);
    const verified = passport.verifyAssertion(buffer, {
      peer,
      nonce: pending.nonce,
      challengeHash: pending.hash,
      network: pending.network,
      allow: pending.request,
      challengeExpiresAt: pending.expiresAt,
      signers,
      now: now()
    });
    if (!verified.ok) return refuse(verified.error, buffer);
    let extra = {};
    if (typeof settings.onSession === 'function') {
      try {
        extra = (await settings.onSession(verified, conn)) || {};
      } catch (err) {
        return refuse((err && err.message) || 'sign-in refused', buffer);
      }
    }
    const frame = passport.createPeerSession({
      assertionHash: sha256Hex(buffer),
      pubkey: verified.identity.pubkey,
      sessionKey: verified.sessionKey,
      ttlMs: settings.sessionTtlMs,
      now: now()
    }, key);
    const record = {
      sessionId: frame.sessionId,
      assertionHash: sha256Hex(buffer),
      identityId: verified.identity.id,
      pubkey: verified.identity.pubkey,
      sessionKey: verified.sessionKey,
      network: verified.network,
      signer: verified.signer,
      device: verified.device,
      origin: verified.origin,
      wallet: verified.wallet || null,
      cosigner: verified.cosigner || null,
      extra,
      issuedAt: frame.issuedAt,
      expiresAt: frame.expiresAt
    };
    await store.put(record.sessionId, record);
    bind(state, record);
    return { replies: [frame.message.toBuffer()], session: sessionView(record) };
  }

  async function onResume (state, buffer) {
    const pending = state.challenge;
    state.challenge = null;
    if (!pending) return refuse('no challenge on this connection', buffer);
    const read = passport.readResume(buffer, {
      peer,
      nonce: pending.nonce,
      challengeHash: pending.hash,
      challengeExpiresAt: pending.expiresAt,
      now: now()
    });
    if (!read.ok) return refuse(read.error, buffer);
    const record = await store.get(read.sessionId);
    const at = now();
    if (!record || record.expiresAt <= at) return refuse('unknown or expired session', buffer);
    if (record.sessionKey.slice(2) !== read.author) return refuse('resume is not signed by the session key', buffer);
    const frame = passport.createPeerSession({
      sessionId: record.sessionId,
      assertionHash: record.assertionHash,
      pubkey: record.pubkey,
      sessionKey: record.sessionKey,
      ttlMs: record.expiresAt - at,
      now: at
    }, key);
    bind(state, record);
    return { replies: [frame.message.toBuffer()], session: sessionView(record), resumed: true };
  }

  /**
   * Answer one Passport frame received on `conn`.
   * @param {object} conn The connection it arrived on.
   * @param {Buffer|Uint8Array|Message} input Raw frame bytes.
   * @returns {Promise<{ replies: Buffer[], session: (object|undefined), resumed: (boolean|undefined), error: (string|undefined) }>}
   */
  async function handleFrame (conn, input) {
    const buffer = toBuffer(input);
    const type = frameType(buffer);
    if (!PASSPORT_PEER_FRAME_TYPES.includes(type)) return refuse('not a Passport peer frame', buffer);
    const state = stateOf(conn);
    if (type === 'PASSPORT_CONNECT') return onConnect(state, buffer);
    if (type === 'PASSPORT_ASSERTION') return onAssertion(conn, state, buffer);
    return onResume(state, buffer);
  }

  /**
   * The session a frame on `conn` speaks for: signed by a session key bound
   * on that connection, and the session still live. Otherwise null.
   * @param {object} conn
   * @param {Buffer|Uint8Array|Message} input Raw frame bytes.
   * @returns {Promise<(object|null)>}
   */
  async function callerOf (conn, input) {
    const state = connections.get(conn);
    if (!state || !state.sessions.size) return null;
    const buffer = toBuffer(input);
    if (!buffer || buffer.length < 144) return null;
    const author = buffer.subarray(40, 72).toString('hex');
    const sessionId = state.sessions.get(author);
    if (!sessionId) return null;
    const verified = Message.verifyFrameAuthor(buffer);
    if (!verified || !verified.ok) return null;
    const record = await store.get(sessionId);
    if (!record || record.expiresAt <= now() || record.sessionKey.slice(2) !== author) {
      state.sessions.delete(author);
      return null;
    }
    return sessionView(record);
  }

  /**
   * Sessions bound on `conn` (live ones only).
   * @param {object} conn
   * @returns {Promise<object[]>}
   */
  async function sessionsFor (conn) {
    const state = connections.get(conn);
    if (!state) return [];
    const out = [];
    for (const sessionId of state.sessions.values()) {
      const record = await store.get(sessionId);
      if (record && record.expiresAt > now()) out.push(sessionView(record));
    }
    return out;
  }

  /**
   * @param {string} sessionId
   * @returns {Promise<(object|null)>}
   */
  async function readSession (sessionId) {
    const record = await store.get(String(sessionId || '').toLowerCase());
    return record && record.expiresAt > now() ? sessionView(record) : null;
  }

  /**
   * Run one handshake frame over HTTP. A `PASSPORT_CONNECT` starts a
   * handshake and returns its binding; the assertion or resume that follows
   * must send that binding back. Each binding is used for one handshake only.
   * @param {(string|null)} binding From `X-Fabric-Binding` (null on connect).
   * @param {Buffer|Uint8Array|Message} input
   * @returns {Promise<{ replies: Buffer[], binding: (string|undefined), session: (object|undefined), error: (string|undefined) }>}
   */
  async function handleHttpFrame (binding, input) {
    const buffer = toBuffer(input);
    const type = frameType(buffer);
    const at = now();
    for (const [key, row] of handshakes) if (row.expiresAt <= at) handshakes.delete(key);
    if (type === 'PASSPORT_CONNECT') {
      if (handshakes.size >= MAX_HTTP_HANDSHAKES) return refuse('busy', buffer);
      const fresh = crypto.randomBytes(32).toString('hex');
      const conn = { http: true };
      handshakes.set(hashSecret(fresh), { conn, expiresAt: at + HTTP_HANDSHAKE_TTL_MS });
      const out = await handleFrame(conn, buffer);
      return Object.assign({ binding: fresh }, out);
    }
    if (type !== 'PASSPORT_ASSERTION' && type !== 'PASSPORT_RESUME') return refuse('not a Passport peer frame', buffer);
    const key = typeof binding === 'string' && /^[0-9a-f]{64}$/.test(binding) ? hashSecret(binding) : null;
    const row = key ? handshakes.get(key) : null;
    if (key) handshakes.delete(key);
    if (!row) return refuse('unknown or expired handshake', buffer);
    return handleFrame(row.conn, buffer);
  }

  /**
   * The session an HTTP request speaks for, from its `X-Fabric-Request`
   * header: signed by the session's key, for this peer, this method, path
   * and query, and body, not expired, and its nonce never seen before.
   * @param {Object} request
   * @param {string} request.method
   * @param {string} request.target Path and query as received.
   * @param {string} request.header The `X-Fabric-Request` value (`fabric:` frame).
   * @param {Buffer|string} [request.body] Body bytes as received (none for GET).
   * @returns {Promise<{ ok: true, session: object }|{ ok: false, status: number, error: string }>}
   */
  async function authorizeRequest (request = {}) {
    const header = typeof request.header === 'string' ? request.header.trim() : '';
    if (!header) return { ok: false, status: 401, error: 'no Passport request authorization' };
    const read = readPeerRequest(header, {
      peer,
      method: request.method,
      target: request.target,
      body: request.body,
      now: now()
    });
    if (!read.ok) return { ok: false, status: 401, error: read.error };
    const record = await store.get(read.sessionId);
    const at = now();
    if (!record || record.expiresAt <= at) return { ok: false, status: 401, error: 'unknown or expired session' };
    if (record.sessionKey.slice(2) !== read.author) return { ok: false, status: 401, error: 'not signed by the session key' };
    for (const [nonce, expiresAt] of seenNonces) {
      if (expiresAt > at && seenNonces.size < MAX_SEEN_REQUEST_NONCES) break;
      seenNonces.delete(nonce);
    }
    if (seenNonces.has(read.nonce)) return { ok: false, status: 401, error: 'request replayed' };
    seenNonces.set(read.nonce, read.expiresAt + PASSPORT_REQUEST_CLOCK_SKEW_MS);
    return { ok: true, session: sessionView(record) };
  }

  /**
   * End a session everywhere it is bound.
   * @param {string} sessionId
   * @returns {Promise<void>}
   */
  async function revoke (sessionId) {
    await store.delete(String(sessionId || '').toLowerCase());
  }

  /**
   * Forget a closed connection.
   * @param {object} conn
   */
  function close (conn) {
    connections.delete(conn);
  }

  return {
    peer,
    network,
    isPeerFrame: isPassportPeerFrame,
    handleFrame,
    handleHttpFrame,
    authorizeRequest,
    callerOf,
    sessionsFor,
    readSession,
    revoke,
    close,
    sessionView
  };
}

/** @private */
function sendJson (res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

/**
 * Raw bytes of a request body: `req.rawBody` when a parser kept it, else the
 * stream when nobody read it yet. A parsed object without its bytes can't be
 * checked against a signature, so it yields null.
 * @param {import('http').IncomingMessage} req
 * @param {number} [max]
 * @returns {Promise<(Buffer|null)>}
 */
async function readRawBody (req, max = 1024 * 1024) {
  if (req.rawBody != null) return Buffer.isBuffer(req.rawBody) ? req.rawBody : Buffer.from(String(req.rawBody), 'utf8');
  const parsed = req.body;
  const parsedSomething = parsed != null && !(typeof parsed === 'object' && !Buffer.isBuffer(parsed) && !Object.keys(parsed).length);
  if (Buffer.isBuffer(parsed)) return parsed;
  if (typeof parsed === 'string') return Buffer.from(parsed, 'utf8');
  if (parsedSomething) return null;
  if (!req.readable || req.readableEnded) return Buffer.alloc(0);
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > max) {
      const err = new Error('body too large');
      err.status = 413;
      throw err;
    }
    chunks.push(chunk);
  }
  const body = Buffer.concat(chunks);
  req.rawBody = body;
  return body;
}

/**
 * Path and query of a request as the client sent it.
 * @param {import('http').IncomingMessage} req
 * @returns {string}
 */
function requestTarget (req) {
  return String((req && (req.originalUrl || req.url)) || '/');
}

/**
 * HTTP routes and request authorization for a Passport peer.
 * - `GET /sessions/peer` — `{ peer, network }`, the key a page names to Passport.
 * - `POST /sessions/peer { frame }` — one handshake frame; answers `{ frame,
 *   binding? }`. Send the binding back as `X-Fabric-Binding` with the assertion.
 * - {@link readRequestSession} — the session an `X-Fabric-Request` speaks for.
 * Handlers use only `statusCode`, `setHeader`, and `end`, so they run under
 * Express or a bare `http` server.
 * @param {object} passportPeer From {@link createPassportPeer}.
 * @param {Object} [options]
 * @param {(boolean|string|string[])} [options.trustProxy] As in `passportHttp`.
 * @param {string} [options.path='/sessions/peer']
 * @returns {{ routes: Array<{ method: string, path: string, handler: Function }>, mount: function(object): void, readRequestSession: function(object): Promise<(object|null)>, middleware: function(object, object, Function): void }}
 */
function createPassportPeerHttp (passportPeer, options = {}) {
  if (!passportPeer || typeof passportPeer.handleHttpFrame !== 'function') throw new TypeError('a Passport peer is required');
  const path = options.path || '/sessions/peer';
  const limit = createRateLimit({ limit: 60, windowMs: 60 * 1000 });

  function discover (req, res) {
    return sendJson(res, 200, { peer: passportPeer.peer, network: passportPeer.network || null });
  }

  async function handshake (req, res) {
    try {
      if (!limit(clientKey(req, options.trustProxy))) return sendJson(res, 429, { error: 'slow down' });
      let body = req.body;
      if (body == null || (typeof body === 'object' && !Buffer.isBuffer(body) && !Object.keys(body).length)) {
        const raw = await readRawBody(req, MAX_HANDSHAKE_BODY_BYTES);
        const text = raw ? raw.toString('utf8').trim() : '';
        try {
          body = text.startsWith('{') ? JSON.parse(text) : text;
        } catch (_) {
          return sendJson(res, 400, { error: 'invalid JSON' });
        }
      }
      const uri = body && typeof body === 'object' && typeof body.frame === 'string' ? body.frame : fabricUriFromBody(body);
      const decoded = typeof uri === 'string' ? decodeFabricUri(uri.trim(), { allowUnsigned: true }) : { ok: false };
      if (!decoded.ok) return sendJson(res, 400, { error: 'a Passport frame is required' });
      const binding = String((req.headers && req.headers[PASSPORT_BINDING_HEADER]) || '').trim() || null;
      const out = await passportPeer.handleHttpFrame(binding, decoded.buffer);
      const reply = { frame: encodeFabricUri(out.replies[0]) };
      if (out.binding) reply.binding = out.binding;
      return sendJson(res, out.error ? 400 : 200, reply);
    } catch (err) {
      return sendJson(res, err.status || 400, { error: err.message || 'handshake failed' });
    }
  }

  /**
   * The session an `X-Fabric-Request` header speaks for, or null when there
   * is no header. Throws (`status` 401) when there is one and it doesn't hold.
   * @param {import('http').IncomingMessage} req
   * @returns {Promise<(object|null)>}
   */
  async function readRequestSession (req) {
    const header = req && req.headers && req.headers[PASSPORT_REQUEST_HEADER];
    if (!header) return null;
    const body = await readRawBody(req);
    if (body == null) {
      const err = new Error('the request body was parsed before its signature could be checked');
      err.status = 400;
      throw err;
    }
    const out = await passportPeer.authorizeRequest({
      method: req.method,
      target: requestTarget(req),
      header: String(header),
      body
    });
    if (!out.ok) {
      const err = new Error(out.error);
      err.status = out.status;
      throw err;
    }
    return out.session;
  }

  /** Express middleware: sets `req.passportSession`, or answers 401 for a bad `X-Fabric-Request`. */
  function middleware (req, res, next) {
    if (!req.headers || !req.headers[PASSPORT_REQUEST_HEADER]) return next();
    readRequestSession(req).then((session) => {
      req.passportSession = session;
      next();
    }, (err) => sendJson(res, err.status || 401, { error: err.message || 'unauthorized' }));
  }

  const routes = [
    { method: 'GET', path, handler: discover },
    { method: 'POST', path, handler: handshake }
  ];

  function mount (server) {
    for (const route of routes) {
      if (server && typeof server._addRoute === 'function') server._addRoute(route.method, route.path, route.handler);
      else if (server && typeof server[route.method.toLowerCase()] === 'function') server[route.method.toLowerCase()](route.path, route.handler);
      else throw new TypeError('server must have _addRoute or Express verbs');
    }
  }

  return { routes, mount, readRequestSession, middleware };
}

module.exports = {
  PASSPORT_PEER_FRAME_TYPES,
  PASSPORT_REQUEST_HEADER,
  PASSPORT_BINDING_HEADER,
  isPassportPeerFrame,
  readRawBody,
  requestTarget,
  createPassportPeer,
  createPassportPeerHttp
};
