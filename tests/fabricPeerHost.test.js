'use strict';

const assert = require('assert');
const {
  DEFAULT_NETWORK_HUB_SEEDS,
  NETWORK_HUB_HOSTS,
  NETWORK_HUB_HOST_ALIASES,
  isNetworkHubAddress,
  isLoopbackFabricAddress,
  isSelfFabricAddress,
  isFabricAddress,
  normalizeFabricAddress,
  createIsKnownAppRelayType,
  collectOwnFabricHosts
} = require('../functions/fabricPeerHost');

const [HUB_A, HUB_B, HUB_C] = NETWORK_HUB_HOSTS;
const [[NIC_A, NIC_A_HOST], [NIC_B, NIC_B_HOST]] = Object.entries(NETWORK_HUB_HOST_ALIASES);

describe('@fabric/http fabricPeerHost', function () {
  it('exposes default network hub seeds', function () {
    assert.ok(NETWORK_HUB_HOSTS.length >= 3);
    for (const host of NETWORK_HUB_HOSTS) {
      assert.ok(DEFAULT_NETWORK_HUB_SEEDS.includes(`${host}:7777`));
    }
  });

  it('classifies hub / loopback / fabric addresses', function () {
    assert.strictEqual(isNetworkHubAddress(`${HUB_A}:7777`), true);
    assert.strictEqual(isNetworkHubAddress(`${HUB_B}:7777`), true);
    assert.strictEqual(isNetworkHubAddress(`${NIC_A}:7777`), true);
    assert.strictEqual(isNetworkHubAddress(`${NIC_B}:7778`), true);
    assert.strictEqual(isLoopbackFabricAddress('127.0.0.1:7777'), true);
    assert.strictEqual(isFabricAddress('relay.example.com:7777'), true);
    assert.strictEqual(isFabricAddress('https://relay.example.com'), false);
  });

  it('normalizes and migrates legacy https peer URLs', function () {
    assert.strictEqual(normalizeFabricAddress('relay.example.com:7777'), 'relay.example.com:7777');
    assert.strictEqual(normalizeFabricAddress('https://relay.example.com/', { migrate: true }), 'relay.example.com:7777');
    assert.strictEqual(normalizeFabricAddress('https://relay.example.com/', { migrate: false }), null);
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
    assert.deepStrictEqual(splitFabricHostPort('relay.example.com:0'), { host: 'relay.example.com', port: null });
    assert.deepStrictEqual(splitFabricHostPort('relay.example.com:70000'), { host: 'relay.example.com', port: null });
    assert.deepStrictEqual(splitFabricHostPort('[::1]:65536'), { host: '::1', port: null });
    assert.strictEqual(isFabricAddress('relay.example.com:0'), false);
    assert.strictEqual(isFabricAddress('relay.example.com:65536'), false);
    assert.strictEqual(normalizeFabricAddress('relay.example.com:65536'), null);
  });

  it('rewrites stale network-hub :7778 and drops self dials', function () {
    const {
      canonicalizeFabricPeerDial
    } = require('../functions/fabricPeerHost');
    assert.strictEqual(
      canonicalizeFabricPeerDial(`${HUB_A}:7778`, { includeLocalInterfaces: false, resolveDns: false }),
      `${HUB_A}:7777`
    );
    assert.strictEqual(
      canonicalizeFabricPeerDial(`${NIC_A}:7778`, { includeLocalInterfaces: false, resolveDns: false }),
      `${NIC_A_HOST}:7777`
    );
    assert.strictEqual(
      canonicalizeFabricPeerDial(`${NIC_B}:7778`, { includeLocalInterfaces: false, resolveDns: false }),
      `${NIC_B_HOST}:7777`
    );
    assert.strictEqual(
      canonicalizeFabricPeerDial(`${HUB_C}:7778`, {
        listenPort: 7777,
        advertiseHost: HUB_C,
        includeLocalInterfaces: false,
        resolveDns: false
      }),
      null
    );
    assert.strictEqual(
      canonicalizeFabricPeerDial(`${NIC_B}:7778`, {
        listenPort: 7777,
        ownHosts: [NIC_B],
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
    const pin = 'aa'.repeat(32) + `@${HUB_A}:7778`;
    assert.deepStrictEqual(
      require('../functions/fabricPeerHost').splitFabricHostPort(pin),
      { host: HUB_A, port: 7778 }
    );
    assert.strictEqual(
      canonicalizeFabricPeerDial(pin, { includeLocalInterfaces: false, resolveDns: false }),
      `${HUB_A}:7777`
    );
    assert.deepStrictEqual(
      require('../functions/fabricPeerHost').splitFabricHostPort('deadbeef@[::1]:7777'),
      { host: '::1', port: 7777 }
    );
    assert.strictEqual(isFabricAddress(pin), true);
    assert.strictEqual(isFabricAddress('deadbeef@[::1]:7777'), true);
  });

  it('treats advertiseHost / ownHosts as self', function () {
    assert.strictEqual(isSelfFabricAddress('relay.example.com:7777', {
      listenPort: 7777,
      advertiseHost: 'relay.example.com',
      includeLocalInterfaces: false,
      resolveDns: false
    }), true);
    assert.strictEqual(isSelfFabricAddress(`${NIC_A}:7778`, {
      listenPort: 7777,
      ownHosts: [NIC_A],
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
      advertiseHost: 'relay.example.com',
      includeLocalInterfaces: false,
      env: { FABRIC_PUBLIC_HOST: '10.0.0.5' }
    });
    assert.ok(hosts.has('relay.example.com'));
    assert.ok(hosts.has('10.0.0.5'));
  });

  it('dedicated FABRIC_INTERFACE does not treat a sibling NIC as self', function () {
    const nics = {
      eth0: [
        { address: '198.51.100.10', internal: false },
        { address: '198.51.100.20', internal: false }
      ],
      lo: [{ address: '127.0.0.1', internal: true }]
    };
    const opts = {
      advertiseHost: 'relay.example.com',
      env: { FABRIC_INTERFACE: '198.51.100.20' },
      includeLocalInterfaces: true,
      resolveDns: false,
      interfaceAddresses: nics
    };
    const hosts = collectOwnFabricHosts(opts);
    assert.ok(hosts.has('198.51.100.20'));
    assert.ok(hosts.has('relay.example.com'));
    assert.ok(hosts.has('127.0.0.1'));
    assert.ok(!hosts.has('198.51.100.10'));
    assert.strictEqual(isSelfFabricAddress('198.51.100.20:7777', opts), true);
    assert.strictEqual(isSelfFabricAddress('198.51.100.10:7777', opts), false);
    assert.strictEqual(isSelfFabricAddress('hub.example.com:7777', opts), false);
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
