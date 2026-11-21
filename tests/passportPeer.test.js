'use strict';

const assert = require('assert');
const net = require('net');
const os = require('os');
const path = require('path');
const WebSocket = require('ws');

const Key = require('@fabric/core/types/key');
const Message = require('@fabric/core/types/message');
const passport = require('@fabric/core/functions/passport');
const { FIXTURE_SEED } = require('@fabric/core/constants');
const { importSeed, deriveAccount } = require('@fabric/core/functions/accountKeys');

const HTTPServer = require('../types/server');
const { createPassportPeer, isPassportPeerFrame } = require('../functions/passportPeer');
const {
  webSocketTransport,
  httpTransport,
  openWebSocket,
  openPeerSession,
  signWithKey
} = require('../functions/passportPeerClient');

const MASTER = importSeed(FIXTURE_SEED);
const USER = deriveAccount(MASTER, { account: 0, network: 'regtest' });
const PEER = deriveAccount(MASTER, { account: 3, network: 'regtest' }).identity.key;
const OTHER = deriveAccount(MASTER, { account: 4, network: 'regtest' }).identity.key;

function ephemeralPort () {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.listen(0, '127.0.0.1', () => {
      const addr = s.address();
      const port = typeof addr === 'object' && addr ? addr.port : null;
      s.close((err) => (err ? reject(err) : resolve(port)));
    });
    s.on('error', reject);
  });
}

function bytes (data) {
  return Buffer.isBuffer(data) ? data : Buffer.from(new Uint8Array(data));
}

function next (ws, type, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { ws.off('message', on); reject(new Error(`no ${type}`)); }, timeoutMs);
    function on (raw) {
      const data = bytes(raw);
      if (data.length < 76) return;
      if (Message.canonicalTypeName(data.readUInt32BE(72)) !== type) return;
      clearTimeout(timer);
      ws.off('message', on);
      resolve(data);
    }
    ws.on('message', on);
  });
}

describe('@fabric/http functions/passportPeer', function () {
  this.timeout(120000);

  let port;
  let server;
  let peer;
  const seen = [];

  before(async function () {
    port = await ephemeralPort();
    peer = createPassportPeer({
      key: PEER,
      network: 'regtest',
      purpose: 'Sign in to the test peer',
      homes: ['https://peer.example'],
      async onSession (verified) {
        if (verified.identity.pubkey === OTHER.pubkey) throw new Error('not a member');
        return { member: verified.identity.id.slice(0, 8) };
      }
    });
    server = new HTTPServer({
      port,
      host: '127.0.0.1',
      interface: '127.0.0.1',
      hostname: '127.0.0.1',
      listen: true,
      accessLog: path.join(os.tmpdir(), `fabric-http-passport-peer-${port}.log`),
      passportPeer: peer
    });
    server._registerMethod('Whoami', function (context) {
      return context.passport ? { identity: context.passport.identity.id, member: context.passport.member } : null;
    }, { withContext: true });
    server._registerMethod('Echo', function (value) { return value; });
    server._addRoute('POST', '/whoami', (req, res) => res.json({ session: req.passportSession || null, body: req.body }));
    server._addRoute('GET', '/whoami', (req, res) => res.json({ session: req.passportSession || null }));
    server.on('passport:session', (event) => seen.push(event));
    await server.start();
  });

  after(async function () {
    if (server) await server.stop();
  });

  async function connect () {
    return openWebSocket(`ws://127.0.0.1:${port}/`, WebSocket);
  }

  it('recognizes only the frames a peer answers', function () {
    const c = passport.createConnect({});
    assert.strictEqual(isPassportPeerFrame(c.message.toBuffer()), true);
    assert.strictEqual(isPassportPeerFrame(Message.fromVector(['JSONCall', '{}']).toBuffer()), false);
  });

  it('signs in by the peer key from an origin nobody pinned, and calls as the session', async function () {
    const ws = await connect();
    try {
      const session = await openPeerSession({
        transport: webSocketTransport(ws),
        peer: PEER.pubkey,
        origin: 'http://localhost:3000',
        request: ['wallet'],
        sign: signWithKey(USER.identity.key, { disclose: ['wallet'], wallet: USER.wallet, origin: 'http://localhost:3000' })
      });
      assert.strictEqual(session.peer, PEER.pubkey);
      assert.strictEqual(session.identity.pubkey, USER.identity.pubkey);
      assert.deepStrictEqual(session.challenge.homes, ['https://peer.example']);
      assert.strictEqual(session.challenge.origin, 'http://localhost:3000');

      const who = await session.call('Whoami');
      assert.deepStrictEqual(who, { identity: USER.identity.id, member: USER.identity.id.slice(0, 8) });
      assert.strictEqual(await session.call('Echo', ['o7']), 'o7', 'other methods are unchanged');

      const event = seen.find((e) => e.session.sessionId === session.sessionId);
      assert.ok(event, 'emits passport:session');
      assert.strictEqual(event.session.origin, 'http://localhost:3000');
      assert.ok(event.session.wallet);
    } finally {
      ws.close();
    }
  });

  it('a call before the session, or signed by another key, carries no identity', async function () {
    const ws = await connect();
    try {
      const transport = webSocketTransport(ws);
      const before = await openPeerSession({ transport, peer: PEER.pubkey, sign: signWithKey(USER.identity.key) });
      assert.ok(before.sessionId);
      // Same body, signed by a key that holds no session on this socket.
      const body = JSON.stringify({ method: 'Whoami', params: [] });
      const hash = require('../functions/fabricJsonRpcTransport').computeWebSocketJsonCallHashPair(body).hash;
      const frame = Message.fromVector(['JSONCall', body]).signWithKey(new Key());
      const answer = new Promise((resolve) => {
        ws.on('message', function on (data) {
          try {
            const parsed = JSON.parse(Message.fromBuffer(bytes(data)).body);
            if (parsed.params && parsed.params[0] === hash) { ws.off('message', on); resolve(parsed.params[1]); }
          } catch (_) {}
        });
      });
      ws.send(frame.toBuffer());
      assert.strictEqual(await answer, null);
    } finally {
      ws.close();
    }
  });

  it('refuses an impostor peer, a stranger the host refuses, and an assertion with no challenge', async function () {
    const ws = await connect();
    try {
      await assert.rejects(openPeerSession({
        transport: webSocketTransport(ws),
        peer: OTHER.pubkey,
        sign: signWithKey(USER.identity.key)
      }), /another peer/);
      await assert.rejects(openPeerSession({
        transport: webSocketTransport(ws),
        peer: PEER.pubkey,
        sign: signWithKey(OTHER)
      }), /not a member/);
      const site = passport.createPeerChallenge({ clientNonce: 'ab'.repeat(32), network: 'regtest' }, PEER);
      const orphan = passport.signAssertion({ challenge: site.uri, signer: 'passport', network: 'regtest', sessionKey: new Key().pubkey }, USER.identity.key);
      const refused = next(ws, 'PASSPORT_REFUSED');
      ws.send(orphan.message.toBuffer());
      assert.match(passport.readRefusal(await refused).error, /no challenge/);
    } finally {
      ws.close();
    }
  });

  it('refuses an assertion relayed onto another connection', async function () {
    const victim = await connect();
    const relay = await connect();
    try {
      // The relay gets its own challenge, then hands the victim's assertion to the peer.
      const relayConnect = passport.createConnect({ peer: PEER.pubkey });
      const relayChallenge = next(relay, 'PASSPORT_CHALLENGE');
      relay.send(relayConnect.message.toBuffer());
      await relayChallenge;

      let lifted = null;
      await openPeerSession({
        transport: webSocketTransport(victim),
        peer: PEER.pubkey,
        sign: async (ctx) => {
          lifted = await signWithKey(USER.identity.key)(ctx);
          return lifted;
        }
      });
      const refused = next(relay, 'PASSPORT_REFUSED');
      relay.send(lifted);
      const read = passport.readRefusal(await refused);
      assert.match(read.error, /nonce mismatch|challengeHash mismatch/);
    } finally {
      victim.close();
      relay.close();
    }
  });

  it('resumes a session on a new connection with the session key alone', async function () {
    const first = await connect();
    const sessionKey = new Key();
    const session = await openPeerSession({ transport: webSocketTransport(first), peer: PEER.pubkey, sessionKey, sign: signWithKey(USER.identity.key) });
    first.close();

    const second = await connect();
    try {
      const resumed = await openPeerSession({ transport: webSocketTransport(second), peer: PEER.pubkey, sessionKey, resume: session.sessionId });
      assert.strictEqual(resumed.resumed, true);
      assert.strictEqual(resumed.sessionId, session.sessionId);
      assert.strictEqual(resumed.expiresAt, session.expiresAt);
      assert.strictEqual((await resumed.call('Whoami')).identity, USER.identity.id);

      // Another key can't resume it.
      await assert.rejects(openPeerSession({ transport: webSocketTransport(second), peer: PEER.pubkey, sessionKey: new Key(), resume: session.sessionId }), /session key/);

      // A revoked session no longer speaks for anyone.
      await peer.revoke(session.sessionId);
      assert.strictEqual(await resumed.call('Whoami'), null);
    } finally {
      second.close();
    }
  });

  it('signs in over plain HTTP and authorizes each request once, for its own method, path, and body', async function () {
    const base = `http://127.0.0.1:${port}`;
    const session = await openPeerSession({
      transport: httpTransport(base),
      peer: PEER.pubkey,
      origin: 'https://app.example',
      sign: signWithKey(USER.identity.key, { origin: 'https://app.example' })
    });
    assert.strictEqual(session.identity.pubkey, USER.identity.pubkey);

    const body = JSON.stringify({ text: 'o7' });
    const res = await session.fetch(`${base}/whoami?room=1`, { method: 'POST', body, headers: { 'Content-Type': 'application/json' } });
    const json = await res.json();
    assert.strictEqual(res.status, 200, JSON.stringify(json));
    assert.strictEqual(json.session.identity.pubkey, USER.identity.pubkey);
    assert.deepStrictEqual(json.body, { text: 'o7' }, 'the route still sees the parsed body');

    const get = await (await session.fetch(`${base}/whoami`)).json();
    assert.strictEqual(get.session.sessionId, session.sessionId);
    assert.strictEqual((await (await fetch(`${base}/whoami`)).json()).session, null, 'no header, no session');

    // The same header again, or on another body or path, is refused.
    const header = session.authorize({ method: 'POST', target: '/whoami', body });
    const send = (target, b) => fetch(`${base}${target}`, { method: 'POST', body: b, headers: { 'Content-Type': 'application/json', 'X-Fabric-Request': header } });
    assert.strictEqual((await send('/whoami', body)).status, 200);
    const replay = await send('/whoami', body);
    assert.strictEqual(replay.status, 401);
    assert.match((await replay.json()).error, /replayed/);
    const other = session.authorize({ method: 'POST', target: '/whoami', body });
    const tampered = await fetch(`${base}/whoami`, { method: 'POST', body: '{"text":"pay me"}', headers: { 'Content-Type': 'application/json', 'X-Fabric-Request': other } });
    assert.strictEqual(tampered.status, 401);

    // An assertion can't be posted without the binding its connect returned.
    const c = passport.createConnect({ peer: PEER.pubkey });
    const started = await (await fetch(`${base}/sessions/peer`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ frame: c.uri }) })).json();
    assert.ok(started.binding);
    const lifted = await signWithKey(USER.identity.key)({ challenge: started.frame, read: passport.readChallenge(started.frame), sessionKey: new Key().pubkey });
    const { encodeFabricUri } = require('@fabric/core/functions/fabricUri');
    const noBinding = await fetch(`${base}/sessions/peer`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ frame: encodeFabricUri(lifted) }) });
    assert.strictEqual(noBinding.status, 400);
    assert.match(passport.readRefusal((await noBinding.json()).frame).error, /handshake/);
  });

  it('never forgets a live request nonce: when full, new requests wait', async function () {
    const small = createPassportPeer({ key: PEER, network: 'regtest', maxRequestNonces: 2 });
    const conn = {};
    const listeners = new Set();
    const transport = {
      send (buffer) {
        small.handleFrame(conn, buffer).then((out) => {
          for (const reply of out.replies) for (const l of listeners) l(reply);
        });
      },
      onFrame (fn) { listeners.add(fn); return () => listeners.delete(fn); },
      close () {}
    };
    const session = await openPeerSession({ transport, peer: PEER.pubkey, sign: signWithKey(USER.identity.key) });
    const ask = (header) => small.authorizeRequest({ method: 'GET', target: '/x', header });
    const first = session.authorize({ method: 'GET', target: '/x' });
    assert.strictEqual((await ask(first)).ok, true);
    assert.strictEqual((await ask(session.authorize({ method: 'GET', target: '/x' }))).ok, true);
    const full = await ask(session.authorize({ method: 'GET', target: '/x' }));
    assert.strictEqual(full.status, 503);
    const replay = await ask(first);
    assert.strictEqual(replay.status, 401);
    assert.match(replay.error, /replayed/);
  });

  it('works without HTTP: any transport object', async function () {
    const standalone = createPassportPeer({ key: PEER, network: 'regtest' });
    const conn = {};
    const listeners = new Set();
    const transport = {
      send (buffer) {
        standalone.handleFrame(conn, buffer).then((out) => {
          for (const reply of out.replies) for (const l of listeners) l(reply);
        });
      },
      onFrame (fn) { listeners.add(fn); return () => listeners.delete(fn); },
      close () {}
    };
    const session = await openPeerSession({ transport, peer: PEER.pubkey, sign: signWithKey(USER.identity.key, { signer: 'gooncitizen' }) });
    const signed = session.sign(Message.fromVector(['JSONCall', '{"method":"x","params":[]}']));
    const caller = await standalone.callerOf(conn, signed.toBuffer());
    assert.strictEqual(caller.identity.pubkey, USER.identity.pubkey);
    assert.strictEqual(caller.signer, 'gooncitizen');
    assert.strictEqual(await standalone.callerOf({}, signed.toBuffer()), null, 'bound to its connection');
    assert.strictEqual(await standalone.callerOf(conn, signed.toBuffer()), null, 'a frame sent again speaks for nobody');
    const next = session.sign(Message.fromVector(['JSONCall', '{"method":"x","params":[],"nonce":"1"}']));
    assert.strictEqual((await standalone.callerOf(conn, next.toBuffer())).identity.pubkey, USER.identity.pubkey, 'a new call still does');
  });

  it('remembers the frames a session spoke across connections: a resumed session never replays one', async function () {
    const peerSide = createPassportPeer({ key: PEER, network: 'regtest' });
    const transportOn = (conn) => {
      const listeners = new Set();
      return {
        send (buffer) {
          peerSide.handleFrame(conn, buffer).then((out) => {
            for (const reply of out.replies) for (const l of listeners) l(reply);
          });
        },
        onFrame (fn) { listeners.add(fn); return () => listeners.delete(fn); },
        close () {}
      };
    };
    const a = {};
    const b = {};
    const sessionKey = new Key();
    const session = await openPeerSession({ transport: transportOn(a), peer: PEER.pubkey, sessionKey, sign: signWithKey(USER.identity.key) });
    const captured = session.sign(Message.fromVector(['JSONCall', '{"method":"pay","params":[]}'])).toBuffer();
    assert.ok(await peerSide.callerOf(a, captured));
    await openPeerSession({ transport: transportOn(b), peer: PEER.pubkey, sessionKey, resume: session.sessionId });
    assert.strictEqual(await peerSide.callerOf(b, captured), null, 'replayed after a resume');
    assert.strictEqual(await peerSide.callerOf(a, captured), null, 'replayed on the first connection');
    const fresh = session.sign(Message.fromVector(['JSONCall', '{"method":"pay","params":[],"nonce":"2"}'])).toBuffer();
    assert.ok(await peerSide.callerOf(b, fresh), 'a new call still speaks');
  });

  it('refuses session calls past the replay limit instead of running them anonymously, until the user signs in again', async function () {
    const small = createPassportPeer({ key: PEER, network: 'regtest', maxFramesPerSession: 2 });
    const transportOn = (conn) => {
      const listeners = new Set();
      return {
        send (buffer) {
          small.handleFrame(conn, buffer).then((out) => {
            for (const reply of out.replies) for (const l of listeners) l(reply);
          });
        },
        onFrame (fn) { listeners.add(fn); return () => listeners.delete(fn); },
        close () {}
      };
    };
    const conn = {};
    const sessionKey = new Key();
    const session = await openPeerSession({ transport: transportOn(conn), peer: PEER.pubkey, sessionKey, sign: signWithKey(USER.identity.key) });
    const frame = (n) => session.sign(Message.fromVector(['JSONCall', JSON.stringify({ method: 'x', params: [], nonce: String(n) })])).toBuffer();
    const first = frame(1);
    assert.ok(await small.callerOf(conn, first));
    assert.ok(await small.callerOf(conn, frame(2)));
    const limit = (err) => err.code === 'passport_replay_limit';
    await assert.rejects(small.callerOf(conn, frame(3)), limit);
    await assert.rejects(small.callerOf(conn, first), limit, 'a replay does not speak either');
    const stranger = Message.fromVector(['JSONCall', '{"method":"x","params":[]}']).signWithKey(new Key()).toBuffer();
    assert.strictEqual(await small.callerOf(conn, stranger), null, 'calls not signed by a session are unchanged');
    const fresh = {};
    await assert.rejects(openPeerSession({ transport: transportOn(fresh), peer: PEER.pubkey, sessionKey, resume: session.sessionId }), limit,
      'resuming elsewhere does not reset what the session spoke');
    const again = await openPeerSession({ transport: transportOn(fresh), peer: PEER.pubkey, sign: signWithKey(USER.identity.key) });
    const call = again.sign(Message.fromVector(['JSONCall', '{"method":"x","params":[]}'])).toBuffer();
    assert.strictEqual((await small.callerOf(fresh, call)).identity.pubkey, USER.identity.pubkey, 'a new sign-in speaks');
  });

  it('tells a WebSocket client it hit the replay limit, and the client stops calling', async function () {
    const limitedPort = await ephemeralPort();
    const limitedPeer = createPassportPeer({ key: PEER, network: 'regtest', maxFramesPerSession: 2 });
    const limited = new HTTPServer({
      port: limitedPort,
      host: '127.0.0.1',
      interface: '127.0.0.1',
      hostname: '127.0.0.1',
      listen: true,
      accessLog: path.join(os.tmpdir(), `fabric-http-passport-peer-${limitedPort}.log`),
      passportPeer: limitedPeer
    });
    let anonymous = 0;
    limited._registerMethod('Whoami', function (context) {
      if (!context.passport) anonymous++;
      return context.passport ? context.passport.identity.id : null;
    }, { withContext: true });
    await limited.start();
    const first = await openWebSocket(`ws://127.0.0.1:${limitedPort}/`, WebSocket);
    const second = await openWebSocket(`ws://127.0.0.1:${limitedPort}/`, WebSocket);
    try {
      const sessionKey = new Key();
      const session = await openPeerSession({ transport: webSocketTransport(first), peer: PEER.pubkey, sessionKey, sign: signWithKey(USER.identity.key) });
      assert.strictEqual(await session.call('Whoami'), USER.identity.id);
      assert.strictEqual(await session.call('Whoami'), USER.identity.id);
      const limit = (err) => err.code === 'passport_replay_limit' && /sign in again/.test(err.message);
      await assert.rejects(session.call('Whoami'), limit);
      await assert.rejects(session.call('Whoami'), limit, 'later calls are refused without sending');
      assert.strictEqual(anonymous, 0, 'no session call ran without its session');

      const again = await openPeerSession({ transport: webSocketTransport(second), peer: PEER.pubkey, sign: signWithKey(USER.identity.key) });
      assert.strictEqual(await again.call('Whoami'), USER.identity.id);
    } finally {
      first.close();
      second.close();
      await limited.stop();
    }
  });
});
