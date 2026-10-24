'use strict';

const assert = require('assert');
const net = require('net');
const WebSocket = require('ws');

const Key = require('@fabric/core/types/key');
const Message = require('@fabric/core/types/message');
const HTTPServer = require('../types/server');
const authMiddleware = require('../middlewares/auth');
const {
  isHttpSharedModeEnabled,
  resolveHttpListenHost,
  applySharedModeWebsocketGate
} = require('../functions/httpSharedMode');
const { httpRequest } = require('./helpers/httpRequest');

const WS_TEST_TOKEN = 'fabric-http-test-ws-token';

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

describe('@fabric/http security hardening', function () {
  // Full HTTPServer construction + start/stop can exceed Mocha defaults on cold CI runners.
  this.timeout(60000);

  it('does not authenticate bearer token when token secret is unset', function (done) {
    // Middleware returns missing_secret before signature verification; token shape is irrelevant.
    const req = { headers: {}, token: 'eyJ0eXAi.dGVzdA.not-a-valid-sig' };
    const res = {};
    const ctx = { settings: { verbosity: 0 } };

    authMiddleware.call(ctx, req, res, () => {
      assert.strictEqual(req.authenticated, false);
      assert.strictEqual(req.tokenError, 'missing_secret');
      done();
    });
  });

  it('accepts websocket client token when it matches configured secret', function () {
    const server = new HTTPServer({
      listen: false,
      websocket: { requireClientToken: true, clientToken: WS_TEST_TOKEN }
    });
    const ok = server._verifyWebSocketClient({
      req: { url: `/?token=${encodeURIComponent(WS_TEST_TOKEN)}`, headers: {} }
    });
    assert.strictEqual(ok, true);
  });

  it('rejects websocket client token when it does not match configured secret', function () {
    const server = new HTTPServer({
      listen: false,
      websocket: { requireClientToken: true, clientToken: WS_TEST_TOKEN }
    });
    const ok = server._verifyWebSocketClient({
      req: { url: '/?token=wrong', headers: {} }
    });
    assert.strictEqual(ok, false);
  });

  it('rejects WebSocket when requireClientToken is set but no clientToken or sharedSecret is configured', function () {
    const server = new HTTPServer({
      listen: false,
      websocket: { requireClientToken: true, clientToken: null, sharedSecret: null }
    });
    const ok = server._verifyWebSocketClient({
      req: { url: '/?token=any', headers: {} }
    });
    assert.strictEqual(ok, false);
  });

  it('authorizes /services/rpc via websocket-style client token fallback', async function () {
    const port = await ephemeralPort();
    const server = new HTTPServer({
      port,
      host: '127.0.0.1',
      interface: '127.0.0.1',
      hostname: '127.0.0.1',
      listen: true,
      jsonRpc: { enabled: true, paths: ['/services/rpc'], requireAuth: true },
      websocket: { requireClientToken: true, clientToken: WS_TEST_TOKEN }
    });

    server._registerMethod('SecurityEcho', (x) => ({ echoed: x }));
    await server.start();
    try {
      const body = JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'SecurityEcho',
        params: [{ ok: true }]
      });
      const r = await httpRequest({
        port,
        method: 'POST',
        path: '/services/rpc',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          Authorization: `Bearer ${WS_TEST_TOKEN}`
        },
        body
      });
      assert.strictEqual(r.statusCode, 200);
      const payload = JSON.parse(r.body);
      assert.deepStrictEqual(payload.result.echoed, { ok: true });
    } finally {
      await server.stop().catch(() => {});
    }
  });

  it('denies WebSocket JSONCall when jsonRpc is enabled with requireAuth but no bearer or client token', async function () {
    const port = await ephemeralPort();
    const server = new HTTPServer({
      port,
      host: '127.0.0.1',
      interface: '127.0.0.1',
      hostname: '127.0.0.1',
      listen: true,
      jsonRpc: { enabled: true, paths: ['/services/rpc'], requireAuth: true },
      websocket: { requireClientToken: false }
    });
    server._registerMethod('NoAuthEcho', (x) => x);

    await server.start();
    try {
      const clientKey = new Key();
      const callBody = JSON.stringify({ method: 'NoAuthEcho', params: [1] });
      const callMessage = Message.fromVector(['JSONCall', callBody]).signWithKey(clientKey);

      const denied = await new Promise((resolve, reject) => {
        const ws = new WebSocket(`ws://127.0.0.1:${port}/`);
        const t = setTimeout(() => {
          ws.close();
          reject(new Error('timeout waiting for denied JSONCall'));
        }, 8000);
        ws.on('open', () => ws.send(callMessage.toBuffer()));
        ws.on('message', (data) => {
          try {
            const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
            const msg = Message.fromBuffer(buf);
            if (msg.friendlyType === 'JSONCall') {
              const inner = JSON.parse(msg.body);
              if (inner.method === 'JSONCallResult' && inner.error) {
                clearTimeout(t);
                ws.close();
                resolve(inner);
              }
            }
          } catch (e) {
            clearTimeout(t);
            reject(e);
          }
        });
        ws.on('error', (e) => {
          clearTimeout(t);
          reject(e);
        });
      });

      assert.strictEqual(denied.error && denied.error.code, -32001);
      const jsonRpcTransport = require('../functions/fabricJsonRpcTransport');
      const expected = jsonRpcTransport.computeWebSocketJsonCallHashPair(callBody);
      assert.strictEqual(denied.params && denied.params[0], expected.hash);
    } finally {
      await server.stop().catch(() => {});
    }
  });

  it('WebSocket JSONCall requires the same transport auth as HTTP when jsonRpc.requireAuth', async function () {
    const port = await ephemeralPort();
    const shared = 'ws-rpc-shared';
    const server = new HTTPServer({
      port,
      host: '127.0.0.1',
      interface: '127.0.0.1',
      hostname: '127.0.0.1',
      listen: true,
      jsonRpc: { enabled: true, paths: ['/services/rpc'], requireAuth: true },
      websocket: { requireClientToken: true, clientToken: shared }
    });
    server._registerMethod('WsRpcEcho', (x) => ({ echoed: x }));

    await server.start();
    try {
      const clientKey = new Key();
      const callBody = JSON.stringify({ method: 'WsRpcEcho', params: [{ k: 1 }] });
      const callMessage = Message.fromVector(['JSONCall', callBody]).signWithKey(clientKey);

      const frames = await new Promise((resolve, reject) => {
        const out = [];
        const ws = new WebSocket(`ws://127.0.0.1:${port}/?token=${encodeURIComponent(shared)}`);
        const t = setTimeout(() => {
          ws.close();
          reject(new Error('timeout waiting for JSONCallResult'));
        }, 8000);
        ws.on('open', () => ws.send(callMessage.toBuffer()));
        ws.on('message', (data) => {
          try {
            const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
            out.push(Message.fromBuffer(buf));
            const last = out[out.length - 1];
            if (last && last.type !== 'P2P_MESSAGE_RECEIPT' && last.friendlyType === 'JSONCall') {
              const inner = JSON.parse(last.body);
              if (inner.method === 'JSONCallResult' && inner.params && inner.params[1]) {
                clearTimeout(t);
                ws.close();
                resolve(out);
              }
            }
          } catch (e) {
            clearTimeout(t);
            reject(e);
          }
        });
        ws.on('error', (e) => {
          clearTimeout(t);
          reject(e);
        });
      });

      const resultFrame = frames.find((f) => f.friendlyType === 'JSONCall');
      assert.ok(resultFrame, 'expected JSONCall result frame');
      const inner = JSON.parse(resultFrame.body);
      assert.deepStrictEqual(inner.params[1], { echoed: { k: 1 } });
    } finally {
      await server.stop().catch(() => {});
    }
  });

  it('drops unauthenticated WebSocket GenericMessage before call dispatch', async function () {
    const port = await ephemeralPort();
    const server = new HTTPServer({
      port,
      host: '127.0.0.1',
      interface: '127.0.0.1',
      hostname: '127.0.0.1',
      listen: true,
      // No bearer / client token → _fabricTransportAuthorized stays false.
      websocket: { requireClientToken: false }
    });
    let callCount = 0;
    server.on('call', () => { callCount += 1; });

    await server.start();
    try {
      const clientKey = new Key();
      const body = JSON.stringify({
        data: { method: 'ShouldNotDispatch', params: [{ evil: true }] }
      });
      const msg = Message.fromVector(['GenericMessage', body]).signWithKey(clientKey);

      await new Promise((resolve, reject) => {
        const ws = new WebSocket(`ws://127.0.0.1:${port}/`);
        const t = setTimeout(() => {
          ws.close();
          resolve();
        }, 600);
        ws.once('close', () => {
          clearTimeout(t);
          resolve();
        });
        ws.on('open', () => {
          try {
            ws.send(msg.toBuffer());
          } catch (e) {
            clearTimeout(t);
            reject(e);
          }
        });
        ws.on('error', (e) => {
          clearTimeout(t);
          reject(e);
        });
      });

      assert.strictEqual(callCount, 0);
    } finally {
      await server.stop().catch(() => {});
    }
  });
});

describe('@fabric/http httpSharedMode', function () {
  it('treats common truthy persisted shapes as shared', function () {
    assert.strictEqual(isHttpSharedModeEnabled(true), true);
    assert.strictEqual(isHttpSharedModeEnabled(1), true);
    assert.strictEqual(isHttpSharedModeEnabled('true'), true);
    assert.strictEqual(isHttpSharedModeEnabled('1'), true);
    assert.strictEqual(isHttpSharedModeEnabled(' YES '), true);
  });

  it('treats falsey and unknown as not shared', function () {
    assert.strictEqual(isHttpSharedModeEnabled(false), false);
    assert.strictEqual(isHttpSharedModeEnabled(0), false);
    assert.strictEqual(isHttpSharedModeEnabled('false'), false);
    assert.strictEqual(isHttpSharedModeEnabled(undefined), false);
    assert.strictEqual(isHttpSharedModeEnabled(null), false);
  });

  it('resolveHttpListenHost defaults and overrides', function () {
    assert.strictEqual(resolveHttpListenHost({ mode: 'relay', env: {} }), '127.0.0.1');
    assert.strictEqual(resolveHttpListenHost({ mode: 'relay', httpSharedMode: true, env: {} }), '0.0.0.0');
    assert.strictEqual(resolveHttpListenHost({ mode: 'server', env: {} }), '0.0.0.0');
    assert.strictEqual(resolveHttpListenHost({
      mode: 'relay',
      httpSharedMode: false,
      env: { FABRIC_HUB_INTERFACE: '192.168.1.10' }
    }), '192.168.1.10');
    assert.strictEqual(resolveHttpListenHost({
      mode: 'relay',
      env: { FABRIC_HUB_INTERFACE: '65.21.231.149', FABRIC_HTTP_INTERFACE: '192.168.1.10' }
    }), '65.21.231.149');
    assert.strictEqual(resolveHttpListenHost({
      mode: 'server',
      host: '127.0.0.1',
      env: {}
    }), '127.0.0.1');
    assert.strictEqual(resolveHttpListenHost({
      mode: 'relay',
      host: '127.0.0.1',
      env: { FABRIC_HUB_INTERFACE: '0.0.0.0' }
    }), '127.0.0.1');
  });

  it('applySharedModeWebsocketGate requires token when shared + env token', function () {
    const gated = applySharedModeWebsocketGate({}, {
      bindAll: true,
      env: { FABRIC_WS_CLIENT_TOKEN: 'ws-token-fixture' }
    });
    assert.strictEqual(gated.websocket.requireClientToken, true);
    assert.strictEqual(gated.websocket.clientToken, 'ws-token-fixture');

    const untouched = applySharedModeWebsocketGate({ websocket: { requireClientToken: false } }, {
      bindAll: true,
      env: { FABRIC_WS_CLIENT_TOKEN: 'ws-token-fixture' }
    });
    assert.strictEqual(untouched.websocket.requireClientToken, false);

    const loopback = applySharedModeWebsocketGate({}, {
      bindAll: false,
      env: { FABRIC_WS_CLIENT_TOKEN: 'ws-token-fixture' }
    });
    assert.ok(!loopback.websocket);
  });

  it('applySharedModeWebsocketGate fail-closes shared bind without env token', function () {
    const gated = applySharedModeWebsocketGate({}, { bindAll: true, env: {} });
    assert.strictEqual(gated.websocket.requireClientToken, true);
    assert.ok(!gated.websocket.clientToken);
  });
});
