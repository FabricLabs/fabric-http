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
    assert.strictEqual(isNetworkHubAddress('65.21.231.166:7777'), true);
    assert.strictEqual(isNetworkHubAddress('65.21.231.149:7778'), true);
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
    assert.strictEqual(isFabricAddress('[2001:db8::1]:65535'), true);
    assert.strictEqual(isFabricAddress('[::::]:7777'), false);
    assert.strictEqual(isFabricAddress('[not-an-ip]:7777'), false);
  });

  it('rejects invalid peer ports (0, >65535, non-decimal)', function () {
    const {
      splitFabricHostPort,
      parseFabricPeerPort,
      isFabricAddress,
      normalizeFabricAddress
    } = require('../functions/fabricPeerHost');
    assert.strictEqual(parseFabricPeerPort('0'), null);
    assert.strictEqual(parseFabricPeerPort('65536'), null);
    assert.strictEqual(parseFabricPeerPort('1e3'), null);
    assert.strictEqual(parseFabricPeerPort('7777'), 7777);
    assert.deepStrictEqual(splitFabricHostPort('relay.goon.vc:0'), { host: 'relay.goon.vc', port: null });
    assert.deepStrictEqual(splitFabricHostPort('relay.goon.vc:70000'), { host: 'relay.goon.vc', port: null });
    assert.deepStrictEqual(splitFabricHostPort('[::1]:65536'), { host: '::1', port: null });
    assert.strictEqual(isFabricAddress('relay.goon.vc:0'), false);
    assert.strictEqual(isFabricAddress('relay.goon.vc:65536'), false);
    assert.strictEqual(normalizeFabricAddress('relay.goon.vc:65536'), null);
  });

  it('rewrites stale network-hub :7778 and drops self dials', function () {
    const {
      canonicalizeFabricPeerDial
    } = require('../functions/fabricPeerHost');
    assert.strictEqual(
      canonicalizeFabricPeerDial('hub.fabric.pub:7778', { includeLocalInterfaces: false, resolveDns: false }),
      'hub.fabric.pub:7777'
    );
    assert.strictEqual(
      canonicalizeFabricPeerDial('65.21.231.166:7778', { includeLocalInterfaces: false, resolveDns: false }),
      'hub.fabric.pub:7777'
    );
    assert.strictEqual(
      canonicalizeFabricPeerDial('65.21.231.149:7778', { includeLocalInterfaces: false, resolveDns: false }),
      'relay.goon.vc:7777'
    );
    assert.strictEqual(
      canonicalizeFabricPeerDial('relay.goon.vc:7778', {
        listenPort: 7777,
        advertiseHost: 'relay.goon.vc',
        includeLocalInterfaces: false,
        resolveDns: false
      }),
      null
    );
    assert.strictEqual(
      canonicalizeFabricPeerDial('65.21.231.149:7778', {
        listenPort: 7777,
        ownHosts: ['65.21.231.149'],
        includeLocalInterfaces: false,
        resolveDns: false
      }),
      null
    );
    assert.strictEqual(
      canonicalizeFabricPeerDial('203.0.113.9:7778', {
        listenPort: 7777,
        includeLocalInterfaces: false,
        resolveDns: false
      }),
      '203.0.113.9:7778'
    );
    const pin = 'aa'.repeat(32) + '@hub.fabric.pub:7778';
    assert.deepStrictEqual(
      require('../functions/fabricPeerHost').splitFabricHostPort(pin),
      { host: 'hub.fabric.pub', port: 7778 }
    );
    assert.strictEqual(
      canonicalizeFabricPeerDial(pin, { includeLocalInterfaces: false, resolveDns: false }),
      'hub.fabric.pub:7777'
    );
    assert.deepStrictEqual(
      require('../functions/fabricPeerHost').splitFabricHostPort('deadbeef@[::1]:7777'),
      { host: '::1', port: 7777 }
    );
    assert.strictEqual(isFabricAddress(pin), true);
    assert.strictEqual(isFabricAddress('deadbeef@[::1]:7777'), true);
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

  it('dedicated FABRIC_INTERFACE does not treat a sibling NIC as self', function () {
    const nics = {
      eth0: [
        { address: '65.21.231.166', internal: false },
        { address: '65.21.231.149', internal: false }
      ],
      lo: [{ address: '127.0.0.1', internal: true }]
    };
    const opts = {
      advertiseHost: 'relay.goon.vc',
      env: { FABRIC_INTERFACE: '65.21.231.149' },
      includeLocalInterfaces: true,
      resolveDns: false,
      interfaceAddresses: nics
    };
    const hosts = collectOwnFabricHosts(opts);
    assert.ok(hosts.has('65.21.231.149'));
    assert.ok(hosts.has('relay.goon.vc'));
    assert.ok(hosts.has('127.0.0.1'));
    assert.ok(!hosts.has('65.21.231.166'));
    assert.strictEqual(isSelfFabricAddress('65.21.231.149:7777', opts), true);
    assert.strictEqual(isSelfFabricAddress('65.21.231.166:7777', opts), false);
    assert.strictEqual(isSelfFabricAddress('hub.fabric.pub:7777', opts), false);
  });

  it('own-host DNS uses a cache primed without lookupSync', async function () {
    const {
      hostnameResolvesToOwn,
      primeOwnHostDns,
      clearOwnHostDnsCache
    } = require('../functions/fabricPeerHost');
    clearOwnHostDnsCache();
    const own = collectOwnFabricHosts({ includeLocalInterfaces: true });
    assert.strictEqual(hostnameResolvesToOwn('localhost', own), false);
    const primed = await primeOwnHostDns('localhost', own);
    assert.strictEqual(typeof primed, 'boolean');
    assert.strictEqual(hostnameResolvesToOwn('localhost', own), primed);
    clearOwnHostDnsCache();
  });
});
