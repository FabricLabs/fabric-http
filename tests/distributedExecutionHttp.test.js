'use strict';

const assert = require('assert');
const FabricDistributedExecutionHTTP = require('../types/distributedExecutionHttp');

describe('types/distributedExecutionHttp', function () {
  it('bind registers routes when callbacks provided', function () {
    const routes = [];
    const server = {
      _addRoute (method, path, handler) {
        routes.push({ method, path });
      }
    };
    const mod = new FabricDistributedExecutionHTTP({
      getManifest: async () => ({ version: 1 }),
      getEpochStatus: async () => ({ ok: true })
    });
    mod.bind(server);
    assert.ok(routes.some((r) => r.path === '/services/distributed/manifest'));
    assert.ok(routes.some((r) => r.path === '/services/distributed/epoch'));
  });
});
