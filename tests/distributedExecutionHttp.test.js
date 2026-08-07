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
      getEpochStatus: async () => ({ ok: true }),
      getSidechainState: async () => ({ clock: 0 }),
      submitSidechainStatePatch: async () => ({ ok: true }),
      getSidechainJournal: async () => ({ entries: [] }),
      getSidechainSnapshots: async () => ({ snapshots: [] })
    });
    mod.bind(server);
    assert.ok(routes.some((r) => r.path === '/services/distributed/manifest'));
    assert.ok(routes.some((r) => r.path === '/services/distributed/epoch'));
    assert.ok(routes.some((r) => r.method === 'GET' && r.path === '/services/distributed/sidechain'));
    assert.ok(routes.some((r) => r.method === 'GET' && r.path === '/services/distributed/statechain'));
    assert.ok(routes.some((r) => r.method === 'POST' && r.path === '/services/distributed/sidechain/patches'));
    assert.ok(routes.some((r) => r.method === 'POST' && r.path === '/services/distributed/statechain/patches'));
    assert.ok(routes.some((r) => r.method === 'GET' && r.path === '/services/distributed/sidechain/journal'));
    assert.ok(routes.some((r) => r.method === 'GET' && r.path === '/services/distributed/sidechain/snapshots'));
    assert.ok(routes.some((r) => r.method === 'GET' && r.path === '/services/distributed/statechain/journal'));
    assert.ok(routes.some((r) => r.method === 'GET' && r.path === '/services/distributed/statechain/snapshots'));
  });
});
