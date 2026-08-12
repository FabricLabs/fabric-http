'use strict';

const assert = require('assert');
const {
  DEFAULT_NETWORK_HUB_SEEDS,
  isNetworkHubAddress,
  isLoopbackFabricAddress,
  isSelfFabricAddress,
  isFabricAddress,
  normalizeFabricAddress,
  createIsKnownAppRelayType,
  collectOwnFabricHosts
} = require('../functions/fabricPeerHost');

describe('@fabric/http fabricPeerHost', function () {
  it('exposes default network hub seeds', function () {
    assert.ok(DEFAULT_NETWORK_HUB_SEEDS.includes('hub.fabric.pub:7777'));
    assert.ok(DEFAULT_NETWORK_HUB_SEEDS.includes('relay.goon.vc:7777'));
  });

  it('classifies hub / loopback / fabric addresses', function () {
    assert.strictEqual(isNetworkHubAddress('hub.fabric.pub:7777'), true);
    assert.strictEqual(isLoopbackFabricAddress('127.0.0.1:7777'), true);
    assert.strictEqual(isFabricAddress('relay.goon.vc:7777'), true);
    assert.strictEqual(isFabricAddress('https://relay.goon.vc'), false);
  });

  it('normalizes and migrates legacy https peer URLs', function () {
    assert.strictEqual(normalizeFabricAddress('relay.goon.vc:7777'), 'relay.goon.vc:7777');
    assert.strictEqual(normalizeFabricAddress('https://relay.goon.vc/', { migrate: true }), 'relay.goon.vc:7777');
    assert.strictEqual(normalizeFabricAddress('https://relay.goon.vc/', { migrate: false }), null);
  });

  it('detects self loopback only on listen port', function () {
    assert.strictEqual(isSelfFabricAddress('127.0.0.1:7777', 7777), true);
    assert.strictEqual(isSelfFabricAddress('127.0.0.1:7778', 7777), false);
  });

  it('parses bracketed IPv6 host:port without truncating the host', function () {
    const { splitFabricHostPort } = require('../functions/fabricPeerHost');
    assert.deepStrictEqual(splitFabricHostPort('[::1]:7777'), { host: '::1', port: 7777 });
    assert.strictEqual(isLoopbackFabricAddress('[::1]:7777'), true);
    assert.strictEqual(isSelfFabricAddress('[::1]:7777', 7777), true);
    assert.strictEqual(isFabricAddress('[::1]:7777'), true);
    assert.strictEqual(normalizeFabricAddress('[::1]:7777'), '[::1]:7777');
  });

  it('treats advertiseHost / ownHosts as self', function () {
    assert.strictEqual(isSelfFabricAddress('relay.goon.vc:7777', {
      listenPort: 7777,
      advertiseHost: 'relay.goon.vc',
      includeLocalInterfaces: false,
      resolveDns: false
    }), true);
    assert.strictEqual(isSelfFabricAddress('65.21.231.166:7778', {
      listenPort: 7777,
      ownHosts: ['65.21.231.166'],
      includeLocalInterfaces: false,
      resolveDns: false
    }), true);
  });

  it('createIsKnownAppRelayType uses injectable catalog', function () {
    const isKnown = createIsKnownAppRelayType(['DirectChat', 'GroupChat']);
    assert.strictEqual(isKnown('DirectChat'), true);
    assert.strictEqual(isKnown('NotARealType'), false);
  });

  it('collectOwnFabricHosts merges advertise + env', function () {
    const hosts = collectOwnFabricHosts({
      advertiseHost: 'relay.goon.vc',
      includeLocalInterfaces: false,
      env: { FABRIC_PUBLIC_HOST: '10.0.0.5' }
    });
    assert.ok(hosts.has('relay.goon.vc'));
    assert.ok(hosts.has('10.0.0.5'));
  });
});
