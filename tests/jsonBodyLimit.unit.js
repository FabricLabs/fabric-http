'use strict';

const assert = require('assert');
const { resolveJsonBodyLimitForRequest } = require('../functions/jsonBodyLimit');

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
});
