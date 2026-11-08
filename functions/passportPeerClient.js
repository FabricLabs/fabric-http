'use strict';

/**
 * @fileoverview Passport peer sessions (v3), signer side: open a session with
 * a peer named by its Fabric key, over a connection this side opened. Runs in
 * Node and in browsers (Passport's offscreen document, native apps, tests).
 *
 * The client sends `PASSPORT_CONNECT`, checks the peer's signed challenge
 * (signed by the expected key, echoing this connection's nonce), has `sign`
 * produce the assertion (Passport's prompt, a local key, a delegate), and
 * reads the peer's `PASSPORT_SESSION`. The session key is generated here and
 * never leaves; every later frame is signed with it.
 *
 * Over a WebSocket ({@link webSocketTransport}) the session is bound to that
 * socket and calls are signed `JSONCall`s. Over plain HTTP
 * ({@link httpTransport}) the handshake runs on `POST /sessions/peer`, and
 * every request carries an `X-Fabric-Request` signed by the session key
 * (`authorize`, `fetch` on the session handle).
 *
 * A session carries a bounded number of signed calls, across every connection
 * it resumes on. Past it, the peer refuses them (and resumes) and `call`
 * rejects with `code` `passport_replay_limit`: sign in again for a new session.
 */

const crypto = require('crypto');
const passport = require('@fabric/core/functions/passport');
const Key = require('@fabric/core/types/key');
const Message = require('@fabric/core/types/message');
const { encodeFabricUri, decodeFabricUri } = require('@fabric/core/functions/fabricUri');
const { computeWebSocketJsonCallHashPair, JSON_CALL_RESULT_METHOD } = require('./fabricJsonRpcTransport');
const { createPeerRequest, PASSPORT_REPLAY_LIMIT, PASSPORT_REPLAY_LIMIT_CODE } = require('./passportPeerRequest');

/** How long to wait for the peer (not the user) to answer a frame. */
const PEER_REPLY_TIMEOUT_MS = 15 * 1000;
/** How long the user may take to approve (a challenge's longest life plus skew). */
const SIGN_TIMEOUT_MS = 3 * 60 * 1000 + 30 * 1000;

/** @private */
function toBuffer (data) {
  if (Buffer.isBuffer(data)) return data;
  if (data instanceof ArrayBuffer) return Buffer.from(new Uint8Array(data));
  if (ArrayBuffer.isView(data)) return Buffer.from(data.buffer, data.byteOffset, data.byteLength);
  if (data instanceof Message) return data.toBuffer();
  return null;
}

/** @private */
function frameType (buffer) {
  if (!buffer || buffer.length < 76) return null;
  return Message.canonicalTypeName(buffer.readUInt32BE(72));
}

/**
 * Wrap a WebSocket (browser `WebSocket` or Node `ws`) as a frame transport.
 * @param {object} ws
 * @returns {{ send: function(Buffer): void, onFrame: function(function(Buffer): void): function(): void, close: function(): void }}
 */
function webSocketTransport (ws) {
  if (ws && 'binaryType' in ws) ws.binaryType = 'arraybuffer';
  return {
    send (buffer) {
      ws.send(buffer);
    },
    onFrame (handler) {
      const listener = (event) => {
        const data = event && event.data !== undefined ? event.data : event;
        const buffer = toBuffer(data);
        if (buffer) handler(buffer);
      };
      if (typeof ws.addEventListener === 'function') {
        ws.addEventListener('message', listener);
        return () => ws.removeEventListener('message', listener);
      }
      ws.on('message', listener);
      return () => ws.off('message', listener);
    },
    close () {
      try { ws.close(); } catch (_) {}
    }
  };
}

/**
 * The handshake over plain HTTP: each frame is a `POST <base><path>` whose
 * answer is the peer's next frame. The binding the connect returns goes back
 * with the assertion (`X-Fabric-Binding`).
 * @param {string} base `http(s)://host[:port]` of the peer.
 * @param {Object} [options]
 * @param {Function} [options.fetch] Defaults to the global `fetch`.
 * @param {string} [options.path='/sessions/peer']
 * @param {Object} [options.headers] Sent with every handshake request.
 * @returns {{ base: string, send: function(Buffer): void, onFrame: function(function(Buffer): void): function(): void, close: function(): void }}
 */
function httpTransport (base, options = {}) {
  const fetchImpl = options.fetch || (typeof fetch === 'function' ? fetch : null);
  if (!fetchImpl) throw new TypeError('httpTransport: fetch is required');
  const origin = new URL(String(base)).origin;
  const url = `${origin}${options.path || '/sessions/peer'}`;
  const listeners = new Set();
  let binding = null;
  const deliver = (buffer) => { for (const listener of [...listeners]) listener(buffer); };
  return {
    base: origin,
    send (buffer) {
      const headers = Object.assign({ 'Content-Type': 'application/json', Accept: 'application/json' }, options.headers || {});
      if (binding && frameType(buffer) !== 'PASSPORT_CONNECT') headers['X-Fabric-Binding'] = binding;
      Promise.resolve(fetchImpl(url, { method: 'POST', headers, body: JSON.stringify({ frame: encodeFabricUri(buffer) }), cache: 'no-store' }))
        .then(async (res) => {
          const json = await res.json().catch(() => ({}));
          if (json && typeof json.binding === 'string') binding = json.binding;
          const decoded = json && typeof json.frame === 'string' ? decodeFabricUri(json.frame, { allowUnsigned: true }) : null;
          if (decoded && decoded.ok) return deliver(decoded.buffer);
          deliver(passport.createRefusal({ error: (json && json.error) || `HTTP ${res.status}`, answers: buffer }).message.toBuffer());
        })
        .catch((err) => deliver(passport.createRefusal({ error: (err && err.message) || 'unreachable', answers: buffer }).message.toBuffer()));
    },
    onFrame (handler) {
      listeners.add(handler);
      return () => listeners.delete(handler);
    },
    close () {
      listeners.clear();
    }
  };
}

/**
 * Open a WebSocket and resolve once it is open.
 * @param {string} url `ws:` / `wss:` URL of the peer.
 * @param {Function} [WebSocketImpl] Defaults to the global `WebSocket`.
 * @param {number} [timeoutMs]
 * @returns {Promise<object>}
 */
function openWebSocket (url, WebSocketImpl, timeoutMs = PEER_REPLY_TIMEOUT_MS) {
  const Impl = WebSocketImpl || (typeof WebSocket !== 'undefined' ? WebSocket : null);
  if (!Impl) return Promise.reject(new Error('no WebSocket implementation'));
  return new Promise((resolve, reject) => {
    const ws = new Impl(url);
    if ('binaryType' in ws) ws.binaryType = 'arraybuffer';
    const timer = setTimeout(() => {
      try { ws.close(); } catch (_) {}
      reject(new Error('peer did not answer'));
    }, timeoutMs);
    const opened = () => { clearTimeout(timer); resolve(ws); };
    const failed = () => { clearTimeout(timer); reject(new Error(`could not connect to ${url}`)); };
    if (typeof ws.addEventListener === 'function') {
      ws.addEventListener('open', opened, { once: true });
      ws.addEventListener('error', failed, { once: true });
    } else {
      ws.once('open', opened);
      ws.once('error', failed);
    }
  });
}

/**
 * Wait for the next frame of one of `types` on `transport`.
 * @private
 */
function nextFrame (transport, types, timeoutMs) {
  return new Promise((resolve, reject) => {
    let off = () => {};
    const timer = setTimeout(() => {
      off();
      reject(new Error('peer did not answer'));
    }, timeoutMs);
    off = transport.onFrame((buffer) => {
      const type = frameType(buffer);
      if (!types.includes(type)) return;
      clearTimeout(timer);
      off();
      resolve({ type, buffer });
    });
  });
}

/** @private */
function refusalError (buffer) {
  const read = passport.readRefusal(buffer);
  const err = new Error(read.ok ? `peer refused: ${read.error}` : 'peer refused');
  err.code = read.ok && read.error === PASSPORT_REPLAY_LIMIT ? PASSPORT_REPLAY_LIMIT : 'peer_refused';
  return err;
}

/** @private */
async function withTimeout (promise, ms, message) {
  let timer = null;
  try {
    return await Promise.race([
      promise,
      new Promise((resolve, reject) => { timer = setTimeout(() => reject(new Error(message)), ms); })
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Open (or resume) a session with a peer.
 * @param {Object} params
 * @param {object} params.transport From {@link webSocketTransport} (or any `{ send, onFrame, close }`).
 * @param {string} [params.peer] Compressed pubkey the peer must be. Omit only to learn a new peer's
 *   key (trust on first use); the caller must then show `peer` to the user before `sign` signs.
 * @param {string} [params.origin] The page that asked (informational).
 * @param {string[]} [params.request] Ask for `wallet` and/or `cosigner`.
 * @param {function({ challenge: string, read: object, sessionKey: string }): Promise<(string|Buffer|Message)>} [params.sign]
 *   Produce the `PASSPORT_ASSERTION` (prompt the user, or sign with a local key). Not called on resume.
 * @param {object} [params.sessionKey] Key to use (generated when omitted; required to resume).
 * @param {string} [params.resume] Session id to resume with `sessionKey`.
 * @param {number} [params.replyTimeoutMs]
 * @param {number} [params.signTimeoutMs]
 * @returns {Promise<object>} A session handle: `{ peer, sessionId, identity, expiresAt, sessionKey, challenge, resumed, sign, call, close }`.
 */
async function openPeerSession (params = {}) {
  const transport = params.transport;
  if (!transport || typeof transport.send !== 'function' || typeof transport.onFrame !== 'function') {
    throw new TypeError('openPeerSession: a transport is required');
  }
  const replyMs = Number(params.replyTimeoutMs) > 0 ? Number(params.replyTimeoutMs) : PEER_REPLY_TIMEOUT_MS;
  const signMs = Number(params.signTimeoutMs) > 0 ? Number(params.signTimeoutMs) : SIGN_TIMEOUT_MS;
  const sessionKey = params.sessionKey || new Key();
  if (!sessionKey.private) throw new TypeError('openPeerSession: sessionKey must be a private key');
  if (params.resume && !params.sessionKey) throw new TypeError('openPeerSession: resuming needs the session key');
  if (!params.resume && typeof params.sign !== 'function') throw new TypeError('openPeerSession: sign is required');

  const connect = passport.createConnect({ peer: params.peer, origin: params.origin, request: params.request });
  const challengeWait = nextFrame(transport, ['PASSPORT_CHALLENGE', 'PASSPORT_REFUSED'], replyMs);
  transport.send(connect.message.toBuffer());
  const got = await challengeWait;
  if (got.type === 'PASSPORT_REFUSED') throw refusalError(got.buffer);
  const read = passport.readChallenge(got.buffer, { peer: params.peer, clientNonce: connect.clientNonce });
  if (!read.ok) throw new Error(`peer challenge: ${read.error}`);
  if (read.challenge.v !== passport.PASSPORT_PEER_VERSION) throw new Error('peer challenge: not a peer challenge');
  const peer = read.challenge.peer;
  const challengeUri = encodeFabricUri(got.buffer);

  let answer;
  let assertionHash = null;
  if (params.resume) {
    answer = passport.createResume({ sessionId: params.resume, challenge: got.buffer, peer }, sessionKey).message.toBuffer();
  } else {
    const signed = await withTimeout(
      Promise.resolve(params.sign({ challenge: challengeUri, read, sessionKey: String(sessionKey.pubkey).toLowerCase() })),
      signMs,
      'timeout'
    );
    answer = toBuffer(signed);
    if (!answer && typeof signed === 'string') {
      const decoded = decodeFabricUri(signed, { allowedTypes: ['PASSPORT_ASSERTION'] });
      if (!decoded.ok) throw new Error(`assertion: ${decoded.error}`);
      answer = decoded.buffer;
    }
    if (!answer || frameType(answer) !== 'PASSPORT_ASSERTION') throw new Error('sign did not return an assertion');
    assertionHash = crypto.createHash('sha256').update(answer).digest('hex');
  }

  const sessionWait = nextFrame(transport, ['PASSPORT_SESSION', 'PASSPORT_REFUSED'], replyMs);
  transport.send(answer);
  const reply = await sessionWait;
  if (reply.type === 'PASSPORT_REFUSED') throw refusalError(reply.buffer);
  const confirmed = passport.readPeerSession(reply.buffer, {
    peer,
    sessionKey: sessionKey.pubkey,
    assertionHash: assertionHash || undefined
  });
  if (!confirmed.ok) throw new Error(`peer session: ${confirmed.error}`);
  if (params.resume && confirmed.session.sessionId !== String(params.resume).toLowerCase()) {
    throw new Error('peer session: the peer resumed another session');
  }
  return createSessionHandle(transport, {
    peer,
    session: confirmed.session,
    sessionKey,
    challenge: read.challenge,
    resumed: !!params.resume,
    replyMs
  });
}

/** @private */
function createSessionHandle (transport, context) {
  const { peer, session, sessionKey, challenge, resumed, replyMs } = context;
  let limited = null;

  /**
   * Sign a frame with the session key.
   * @param {Message} message
   * @returns {Message}
   */
  function sign (message) {
    return message.signWithKey(sessionKey);
  }

  /**
   * An `X-Fabric-Request` value authorizing one HTTP request as this session.
   * @param {{ method: string, target: string, body: (string|Buffer|undefined) }} request
   * @returns {string} `fabric:` frame
   */
  function authorize (request = {}) {
    return createPeerRequest({
      sessionId: session.sessionId,
      peer,
      method: request.method || 'GET',
      target: request.target,
      body: request.body
    }, sessionKey).uri;
  }

  /**
   * `fetch` as this session: same arguments as `fetch`, plus the signed header.
   * The body must be a string or bytes (it is signed as sent).
   * @param {string} url
   * @param {Object} [init]
   * @param {Function} [fetchImpl]
   * @returns {Promise<Response>}
   */
  function fetchAs (url, init = {}, fetchImpl) {
    const f = fetchImpl || (typeof fetch === 'function' ? fetch : null);
    if (!f) throw new TypeError('fetch is required');
    const parsed = new URL(String(url));
    const body = init.body;
    if (body != null && typeof body !== 'string' && !Buffer.isBuffer(body) && !(body instanceof Uint8Array)) {
      throw new TypeError('sign a string or bytes body');
    }
    const headers = Object.assign({}, init.headers || {}, {
      'X-Fabric-Request': authorize({ method: init.method || 'GET', target: `${parsed.pathname}${parsed.search}`, body })
    });
    return f(parsed.href, Object.assign({}, init, { headers }));
  }

  /**
   * Call a JSON-RPC method on the peer as this session.
   * @param {string} method
   * @param {Array} [params]
   * @returns {Promise<*>}
   */
  function call (method, params = []) {
    if (limited) return Promise.reject(limited);
    // The nonce makes each call its own frame: the peer lets a session-signed frame speak once.
    const body = JSON.stringify({ method: String(method), params: Array.isArray(params) ? params : [params], nonce: crypto.randomBytes(16).toString('hex') });
    const { hash } = computeWebSocketJsonCallHashPair(body);
    const frame = sign(Message.fromVector(['JSONCall', body]));
    return new Promise((resolve, reject) => {
      let off = () => {};
      const timer = setTimeout(() => {
        off();
        reject(new Error('peer did not answer'));
      }, replyMs);
      off = transport.onFrame((buffer) => {
        if (frameType(buffer) !== 'JSON_CALL') return;
        let parsed = null;
        try {
          parsed = JSON.parse(Message.fromBuffer(buffer).body);
        } catch (_) {
          return;
        }
        if (!parsed || parsed.method !== JSON_CALL_RESULT_METHOD || !Array.isArray(parsed.params) || parsed.params[0] !== hash) return;
        clearTimeout(timer);
        off();
        if (parsed.error) {
          const err = new Error(parsed.error.message || 'call failed');
          err.code = parsed.error.code;
          if (parsed.error.code === PASSPORT_REPLAY_LIMIT_CODE) {
            err.code = PASSPORT_REPLAY_LIMIT;
            limited = err;
          }
          reject(err);
        } else {
          resolve(parsed.params[1]);
        }
      });
      transport.send(frame.toBuffer());
    });
  }

  return {
    peer,
    sessionId: session.sessionId,
    identity: session.identity,
    issuedAt: session.issuedAt,
    expiresAt: session.expiresAt,
    sessionKey,
    challenge,
    resumed,
    sign,
    call,
    authorize,
    fetch: fetchAs,
    close: () => transport.close()
  };
}

/**
 * A `sign` callback that signs with a local identity key (native apps, tests).
 * @param {object} identityKey The identity's private Key.
 * @param {Object} [options] `signAssertion` params: `signer`, `network`, `disclose`, `wallet`, `cosignerKey`, `origin`.
 * @returns {function({ challenge: string, sessionKey: string }): Promise<Buffer>}
 */
function signWithKey (identityKey, options = {}) {
  return async ({ challenge, read, sessionKey }) => {
    const signed = passport.signAssertion(Object.assign({
      signer: 'passport',
      network: (read && read.challenge && read.challenge.network) || options.network
    }, options, {
      challenge,
      peer: read && read.challenge && read.challenge.peer,
      sessionKey
    }), identityKey);
    return signed.message.toBuffer();
  };
}

module.exports = {
  PEER_REPLY_TIMEOUT_MS,
  SIGN_TIMEOUT_MS,
  webSocketTransport,
  httpTransport,
  openWebSocket,
  openPeerSession,
  signWithKey
};
