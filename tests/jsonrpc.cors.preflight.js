'use strict';

const assert = require('assert');
const net = require('net');
const { httpRequest } = require('./helpers/httpRequest');
const HTTPServer = require('../types/server');

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

describe('JSON-RPC CORS preflight (browser → localhost Hub)', function () {
  this.timeout(60000);

  it('OPTIONS /services/rpc is 204 with CORS headers when cors is enabled', async function () {
    const port = await ephemeralPort();
    const server = new HTTPServer({
      port,
      host: '127.0.0.1',
      interface: '127.0.0.1',
      hostname: '127.0.0.1',
      listen: true,
      cors: true,
      jsonRpc: { enabled: true, paths: ['/services/rpc'] }
    });
    await server.start();
    try {
      const r = await httpRequest({
        port,
        method: 'OPTIONS',
        path: '/services/rpc',
        headers: {
          Origin: 'chrome-extension://test',
          'Access-Control-Request-Method': 'POST',
          'Access-Control-Request-Headers': 'content-type, authorization'
        }
      });
      assert.strictEqual(r.statusCode, 204, `body: ${r.body}`);
      const allow = (r.headers['access-control-allow-origin'] || r.headers['Access-Control-Allow-Origin']);
      assert.ok(allow, 'expected Access-Control-Allow-Origin');
    } finally {
      await server.stop();
    }
  });
});
