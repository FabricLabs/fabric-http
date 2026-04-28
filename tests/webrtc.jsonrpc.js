'use strict';

const assert = require('assert');
const net = require('net');
const HTTPServer = require('../types/server');
const { httpRequest } = require('./helpers/httpRequest');

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

describe('HTTPServer — WebRTC peer registry (JSON-RPC)', function () {
  this.timeout(60000);

  it('RegisterWebRTCPeer / List / Unregister via POST /services/rpc', async function () {
    const port = await ephemeralPort();
    const server = new HTTPServer({
      port,
      host: '127.0.0.1',
      interface: '127.0.0.1',
      hostname: '127.0.0.1',
      listen: true,
      jsonRpc: { enabled: true, paths: ['/services/rpc'], requireAuth: false }
    });
    await server.start();
    try {
      const post = (method, params) =>
        httpRequest({
          port,
          method: 'POST',
          path: '/services/rpc',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params })
        });

      let r = await post('RegisterWebRTCPeer', [{ id: 'p1', label: 'test' }]);
      assert.strictEqual(r.statusCode, 200);
      let b = JSON.parse(r.body);
      assert.deepStrictEqual(b.jsonrpc, '2.0');
      assert.strictEqual(b.result.total, 1);
      const secret = b.result.secret;
      assert.ok(typeof secret === 'string' && secret.length > 0, 'register returns unregister secret');

      r = await post('ListWebRTCPeers', []);
      b = JSON.parse(r.body);
      assert.strictEqual(b.result.peers.length, 1);
      assert.strictEqual(b.result.peers[0].id, 'p1');

      r = await post('UnregisterWebRTCPeer', [{ id: 'p1' }]);
      b = JSON.parse(r.body);
      assert.strictEqual(r.statusCode, 500);
      assert.ok(b.error && b.error.message);

      r = await post('UnregisterWebRTCPeer', [{ id: 'p1', secret: 'nope' }]);
      b = JSON.parse(r.body);
      assert.strictEqual(r.statusCode, 500);
      assert.ok(b.error);

      r = await post('UnregisterWebRTCPeer', [{ id: 'p1', secret }]);
      b = JSON.parse(r.body);
      assert.strictEqual(b.result.total, 0);
    } finally {
      await server.stop().catch(() => {});
    }
  });
});
