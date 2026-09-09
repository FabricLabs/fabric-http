'use strict';

const assert = require('assert');
const HTTPServer = require('../types/server');

describe('HTTPServer JSON body limits', function () {
  it('uses large limit only on RPC (and configured) POST paths', function () {
    const server = new HTTPServer({
      listen: false,
      jsonRpc: { enabled: true, paths: ['/services/rpc'] },
      jsonBodyLimit: '12mb',
      jsonBodyLimitDefault: '100kb',
      jsonBodyLargePaths: ['/services/documents']
    });
    assert.strictEqual(
      server._jsonBodyLimitForRequest({ method: 'POST', path: '/services/rpc' }),
      '12mb'
    );
    assert.strictEqual(
      server._jsonBodyLimitForRequest({ method: 'POST', path: '/services/documents' }),
      '12mb'
    );
    assert.strictEqual(
      server._jsonBodyLimitForRequest({ method: 'POST', path: '/sessions' }),
      '100kb'
    );
    assert.strictEqual(
      server._jsonBodyLimitForRequest({ method: 'GET', path: '/services/rpc' }),
      '100kb'
    );
  });

  it('still treats /services/rpc as large when built-in jsonRpc is disabled', function () {
    const server = new HTTPServer({
      listen: false,
      jsonRpc: { enabled: false },
      jsonBodyLimit: '8mb',
      jsonBodyLimitDefault: '50kb'
    });
    assert.strictEqual(
      server._jsonBodyLimitForRequest({ method: 'POST', path: '/services/rpc' }),
      '8mb'
    );
  });
});
