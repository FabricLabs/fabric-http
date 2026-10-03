'use strict';

const assert = require('assert');
const net = require('net');
const HTTPServer = require('../types/server');
const { httpRequest } = require('./helpers/httpRequest');
const { resolveJsonBodyLimitForRequest } = require('../functions/jsonBodyLimit');

function ephemeralPort () {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : null;
      server.close((err) => (err ? reject(err) : resolve(port)));
    });
    server.on('error', reject);
  });
}

describe('resolveJsonBodyLimitForRequest', function () {
  it('uses large limit only on RPC (and configured) POST paths', function () {
    const settings = {
      jsonRpc: { enabled: true, paths: ['/services/rpc'] },
      jsonBodyLimit: '12mb',
      jsonBodyLimitDefault: '100kb',
      jsonBodyLargePaths: ['/services/documents']
    };
    assert.strictEqual(
      resolveJsonBodyLimitForRequest(settings, { method: 'POST', path: '/services/rpc' }),
      '12mb'
    );
    assert.strictEqual(
      resolveJsonBodyLimitForRequest(settings, { method: 'POST', path: '/services/documents' }),
      '12mb'
    );
    assert.strictEqual(
      resolveJsonBodyLimitForRequest(settings, { method: 'POST', path: '/sessions' }),
      '100kb'
    );
    assert.strictEqual(
      resolveJsonBodyLimitForRequest(settings, { method: 'GET', path: '/services/rpc' }),
      '100kb'
    );
  });

  it('still treats /services/rpc as large when built-in jsonRpc is disabled', function () {
    const settings = {
      jsonRpc: { enabled: false },
      jsonBodyLimit: '8mb',
      jsonBodyLimitDefault: '50kb'
    };
    assert.strictEqual(
      resolveJsonBodyLimitForRequest(settings, { method: 'POST', path: '/services/rpc' }),
      '8mb'
    );
  });

  it('treats trailing-slash RPC paths as large (no 413 on /services/rpc/)', function () {
    const settings = {
      jsonRpc: { enabled: true, paths: ['/services/rpc/'] },
      jsonBodyLimit: '12mb',
      jsonBodyLimitDefault: '100kb',
      jsonBodyLargePaths: ['/services/documents/']
    };
    assert.strictEqual(
      resolveJsonBodyLimitForRequest(settings, { method: 'POST', path: '/services/rpc/' }),
      '12mb'
    );
    assert.strictEqual(
      resolveJsonBodyLimitForRequest(settings, { method: 'POST', path: '/services/rpc' }),
      '12mb'
    );
    assert.strictEqual(
      resolveJsonBodyLimitForRequest(settings, { method: 'POST', path: '/services/documents/' }),
      '12mb'
    );
  });

  it('folds path case so /SERVICES/RPC uses the large limit', function () {
    const settings = {
      jsonRpc: { enabled: true, paths: ['/services/rpc'] },
      jsonBodyLimit: '12mb',
      jsonBodyLimitDefault: '100kb',
      jsonBodyLargePaths: ['/Services/Documents']
    };
    assert.strictEqual(
      resolveJsonBodyLimitForRequest(settings, { method: 'POST', path: '/SERVICES/RPC' }),
      '12mb'
    );
    assert.strictEqual(
      resolveJsonBodyLimitForRequest(settings, { method: 'POST', path: '/services/documents/' }),
      '12mb'
    );
    assert.strictEqual(
      resolveJsonBodyLimitForRequest(settings, { method: 'POST', path: '/SESSIONS' }),
      '100kb'
    );
  });

  it('applies the large limit through the server JSON parser', async function () {
    this.timeout(20000);
    const port = await ephemeralPort();
    const server = new HTTPServer({
      port,
      host: '127.0.0.1',
      interface: '127.0.0.1',
      hostname: '127.0.0.1',
      listen: true,
      jsonRpc: { enabled: true, paths: ['/services/rpc'], requireAuth: false },
      jsonBodyLimit: '20kb',
      jsonBodyLimitDefault: '1kb'
    });
    server._registerMethod('BodySizeEcho', (value) => ({ size: value.blob.length }));
    await server.start();
    const blob = 'x'.repeat(2048);
    const rpcBody = JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'BodySizeEcho',
      params: [{ blob }]
    });
    try {
      const response = await httpRequest({
        port,
        method: 'POST',
        path: '/SERVICES/RPC',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(rpcBody)
        },
        body: rpcBody
      });
      assert.strictEqual(response.statusCode, 200, response.body);
      assert.strictEqual(JSON.parse(response.body).result.size, 2048);

      const smallPath = await httpRequest({
        port,
        method: 'POST',
        path: '/sessions',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(rpcBody)
        },
        body: rpcBody
      });
      assert.strictEqual(smallPath.statusCode, 413, smallPath.body);
    } finally {
      await server.stop();
    }
  });
});
