'use strict';

const assert = require('assert');
const net = require('net');
const WebSocket = require('ws');

const Key = require('@fabric/core/types/key');
const Message = require('@fabric/core/types/message');
const HTTPServer = require('../types/server');
const authMiddleware = require('../middlewares/auth');
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
});
