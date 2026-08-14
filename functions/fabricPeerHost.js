'use strict';

/**
 * Fabric peer address helpers shared by Hub, LiveRelay, and light peer hosts.
 * App-specific CONTRACT_MESSAGE catalogs stay injectable via
 * {@link createIsKnownAppRelayType}.
 */

const { isIP } = require('net');

const DEFAULT_NETWORK_HUB_SEEDS = Object.freeze([
  'hub.fabric.pub:7777',
  'relay.goon.vc:7777'
]);

/** Default TCP peer cap (matches @fabric/core MAX_PEERS soft default for slot fill). */
const DEFAULT_MAX_PEERS = 32;

const MIN_FABRIC_PEER_PORT = 1;
const MAX_FABRIC_PEER_PORT = 65535;

/** @type {Map<string, boolean>} */
const _dnsOwnHostCache = new Map();
/** @type {Set<string>} */
const _dnsOwnHostInflight = new Set();
const DNS_OWN_HOST_CACHE_MAX = 256;

/**
 * Parse a Fabric peer TCP port (decimal integer 1..65535 only).
 * @param {*} raw
 * @returns {number|null}
 */
function parseFabricPeerPort (raw) {
  const s = String(raw == null ? '' : raw).trim();
  if (!/^\d{1,5}$/.test(s)) return null;
  const p = Number(s);
  if (!Number.isInteger(p) || p < MIN_FABRIC_PEER_PORT || p > MAX_FABRIC_PEER_PORT) {
    return null;
  }
  return p;
}

/**
 * Split `host:port`, bracketed IPv6 `[::1]:7777`, or bare host / IPv6.
 * Naive `split(':')[0]` breaks on IPv6 — always use this helper.
 * @param {*} address
 * @returns {{ host: string, port: number|null }}
 */
function splitFabricHostPort (address) {
  const s = String(address || '').trim().toLowerCase();
  if (!s) return { host: '', port: null };

  if (s.startsWith('[')) {
    const end = s.indexOf(']');
    if (end > 1) {
      const host = s.slice(1, end);
      let port = null;
      if (s.length > end + 1 && s[end + 1] === ':') {
        port = parseFabricPeerPort(s.slice(end + 2));
      }
      return { host, port };
    }
  }

  // Exactly one colon ⇒ hostname / IPv4 + port. Multiple colons ⇒ bare IPv6 (no port).
  const firstColon = s.indexOf(':');
  const lastColon = s.lastIndexOf(':');
  if (firstColon > 0 && firstColon === lastColon) {
    const host = s.slice(0, firstColon);
    return { host, port: parseFabricPeerPort(s.slice(firstColon + 1)) };
  }

  return { host: s, port: null };
}

/**
 * True when address is a known network hub seed host (selective Fabric relays).
 * @param {*} address
 * @returns {boolean}
 */
function isNetworkHubAddress (address) {
  const host = splitFabricHostPort(address).host;
  return host === 'hub.fabric.pub' || host === 'relay.goon.vc';
}

/**
 * True when address uses a loopback host (localhost / 127.0.0.1 / ::1).
 * @param {*} address
 * @returns {boolean}
 */
function isLoopbackFabricAddress (address) {
  const host = splitFabricHostPort(address).host;
  return host === 'localhost' || host === '127.0.0.1' || host === '::1';
}

/**
 * Hostnames / IPs that identify this node for dial filtering.
 * @param {Object} [opts]
 * @param {string} [opts.advertiseHost]
 * @param {string[]} [opts.ownHosts]
 * @param {boolean} [opts.includeLocalInterfaces=true]
 * @param {NodeJS.ProcessEnv} [opts.env]
 * @returns {Set<string>}
 */
function collectOwnFabricHosts (opts = {}) {
  const hosts = new Set();
  const add = (raw) => {
    const { host } = splitFabricHostPort(raw);
    if (host) hosts.add(host);
  };
  if (opts.advertiseHost) add(opts.advertiseHost);
  for (const h of opts.ownHosts || []) add(h);
  const env = opts.env || process.env;
  for (const key of [
    'FABRIC_PUBLIC_HOST',
    'FABRIC_ADVERTISE_HOST',
    'FABRIC_INTERFACE',
    'FABRIC_PEER_INTERFACE'
  ]) {
    if (env[key]) add(env[key]);
  }
  if (opts.includeLocalInterfaces !== false) {
    try {
      const os = require('os');
      const ifaces = os.networkInterfaces();
      for (const list of Object.values(ifaces || {})) {
        for (const entry of list || []) {
          if (entry && entry.address) add(entry.address);
        }
      }
    } catch (_) { /* ignore (sandbox / restricted os) */ }
  }
  return hosts;
}

function _setDnsOwnHostCache (cacheKey, hit) {
  _dnsOwnHostCache.set(cacheKey, hit);
  while (_dnsOwnHostCache.size > DNS_OWN_HOST_CACHE_MAX) {
    _dnsOwnHostCache.delete(_dnsOwnHostCache.keys().next().value);
  }
}

function _scheduleDnsOwnHostLookup (key, ownHosts, cacheKey) {
  if (_dnsOwnHostInflight.has(cacheKey) || _dnsOwnHostCache.has(cacheKey)) return;
  _dnsOwnHostInflight.add(cacheKey);
  const dns = require('dns').promises;
  Promise.resolve()
    .then(() => dns.lookup(key, { all: true }))
    .then((rows) => {
      let hit = false;
      const list = Array.isArray(rows) ? rows : (rows ? [rows] : []);
      for (const row of list) {
        const addr = row && (row.address || row);
        if (addr && ownHosts.has(String(addr).toLowerCase())) {
          hit = true;
          break;
        }
      }
      _setDnsOwnHostCache(cacheKey, hit);
    })
    .catch(() => {
      _setDnsOwnHostCache(cacheKey, false);
    })
    .then(() => {
      _dnsOwnHostInflight.delete(cacheKey);
    });
}

/**
 * True when `host` is not an IP literal and DNS resolves it to a local interface.
 * Sync callers read the cache (or `false` on a miss) and a lookup is primed via
 * `dns.promises.lookup` — Node 24 deprecates `dns.lookupSync`.
 * @param {string} host
 * @param {Set<string>} ownHosts
 * @returns {boolean}
 */
function hostnameResolvesToOwn (host, ownHosts) {
  const key = String(host || '').trim().toLowerCase();
  if (!key || !ownHosts || !ownHosts.size) return false;
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(key)) return false;
  if (key.includes(':')) return false; // IPv6 literal — never DNS-resolve
  // Cache key includes ownHosts so different local-interface sets do not share hits.
  const cacheKey = `${key}|${[...ownHosts].sort().join(',')}`;
  if (_dnsOwnHostCache.has(cacheKey)) return _dnsOwnHostCache.get(cacheKey);
  _scheduleDnsOwnHostLookup(key, ownHosts, cacheKey);
  return false;
}

/**
 * Await a DNS own-host resolution (tests / startup prime).
 * @param {string} host
 * @param {Set<string>} ownHosts
 * @returns {Promise<boolean>}
 */
async function primeOwnHostDns (host, ownHosts) {
  hostnameResolvesToOwn(host, ownHosts);
  const key = String(host || '').trim().toLowerCase();
  const cacheKey = `${key}|${[...ownHosts].sort().join(',')}`;
  for (let i = 0; i < 50; i++) {
    if (_dnsOwnHostCache.has(cacheKey)) return _dnsOwnHostCache.get(cacheKey);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  return false;
}

/**
 * True when dialing this address would connect to this process (self-loop).
 * @param {*} address
 * @param {number|string|Object} [listenPortOrOpts]
 * @param {Object} [opts]
 * @returns {boolean}
 */
function isSelfFabricAddress (address, listenPortOrOpts, opts) {
  let listenPort = listenPortOrOpts;
  let options = opts || {};
  if (listenPortOrOpts && typeof listenPortOrOpts === 'object' && !Array.isArray(listenPortOrOpts)) {
    options = listenPortOrOpts;
    listenPort = options.listenPort;
  }
  const { host, port } = splitFabricHostPort(address);
  if (!host) return false;

  if (isLoopbackFabricAddress(address)) {
    const listen = Number(listenPort);
    if (!Number.isFinite(port) || !Number.isFinite(listen) || listen <= 0) return false;
    return port === listen;
  }

  const own = collectOwnFabricHosts(options);
  if (own.has(host)) return true;
  if (options.resolveDns === false) return false;
  if (options.includeLocalInterfaces === false) return false;
  return hostnameResolvesToOwn(host, own);
}

/** Historical playnet Peer port still advertised in gossip / peersDb. */
const STALE_NETWORK_HUB_PEER_PORT = 7778;
/** Canonical Fabric Peer listen port for network hubs. */
const CANONICAL_NETWORK_HUB_PEER_PORT = 7777;

/**
 * Format `host:port`, wrapping IPv6 hosts in brackets.
 * @param {string} host
 * @param {number} port
 * @returns {string|null}
 */
function formatFabricHostPort (host, port) {
  const h = String(host || '').trim().toLowerCase();
  const p = parseFabricPeerPort(port);
  if (!h || p == null) return null;
  if (h.includes(':')) return `[${h}]:${p}`;
  return `${h}:${p}`;
}

/**
 * Drop self-dials; rewrite known network hubs still advertised on historical `:7778`.
 * Desktop nodes that listen on 7778 are unchanged unless the host is this process.
 * @param {*} address
 * @param {number|string|Object} [listenPortOrOpts]
 * @param {Object} [opts]
 * @returns {string|null} `host:port` to dial, or null to skip
 */
function canonicalizeFabricPeerDial (address, listenPortOrOpts, opts) {
  let options = opts || {};
  if (listenPortOrOpts && typeof listenPortOrOpts === 'object' && !Array.isArray(listenPortOrOpts)) {
    options = listenPortOrOpts;
  }
  const { host, port } = splitFabricHostPort(address);
  if (!host || port == null) return null;
  const formatted = formatFabricHostPort(host, port);
  if (!formatted) return null;
  if (isSelfFabricAddress(formatted, options)) return null;
  if (isNetworkHubAddress(formatted) && port === STALE_NETWORK_HUB_PEER_PORT) {
    const rewritten = formatFabricHostPort(host, CANONICAL_NETWORK_HUB_PEER_PORT);
    if (!rewritten || isSelfFabricAddress(rewritten, options)) return null;
    return rewritten;
  }
  return formatted;
}

/**
 * True when `value` looks like a Fabric peer address (`host:port` or `[ipv6]:port`).
 * Port must be a decimal integer in 1..65535.
 * @param {*} value
 * @returns {boolean}
 */
function isFabricAddress (value) {
  const s = String(value || '').trim();
  if (!s || /^https?:\/\//i.test(s)) return false;
  const { host, port } = splitFabricHostPort(s);
  if (!host || port == null) return false;
  if (s.startsWith('[')) {
    return isIP(host) === 6 && /^\[[0-9a-fA-F:]+\]:\d{1,5}$/.test(s);
  }
  return /^[a-zA-Z0-9._-]+:\d{1,5}$/.test(s);
}

/**
 * Normalize operator input to `host:port` (or `[ipv6]:port`).
 * @param {*} value
 * @param {Object} [opts]
 * @param {boolean} [opts.migrate] Migrate legacy `https://host` → `host:7777`
 * @returns {string|null}
 */
function normalizeFabricAddress (value, { migrate = false } = {}) {
  const raw = String(value || '').trim().replace(/\/$/, '');
  if (!raw) return null;
  if (isFabricAddress(raw)) return raw;
  if (migrate && /^https?:\/\//i.test(raw)) {
    try {
      const u = new URL(raw);
      if (!u.hostname) return null;
      const host = u.hostname.includes(':') ? `[${u.hostname}]` : u.hostname;
      return `${host}:7777`;
    } catch (_) {
      return null;
    }
  }
  return null;
}

/**
 * Build a predicate for known application CONTRACT_MESSAGE body types.
 * Apps supply their catalog (group, mission, … types); host stays generic.
 * @param {Iterable<string>|Set<string>} types
 * @returns {(appType: *) => boolean}
 */
function createIsKnownAppRelayType (types) {
  const set = types instanceof Set ? types : new Set(types || []);
  return function isKnownAppRelayType (appType) {
    return set.has(appType);
  };
}

/** Clear DNS own-host cache (tests). */
function clearOwnHostDnsCache () {
  _dnsOwnHostCache.clear();
  _dnsOwnHostInflight.clear();
}

module.exports = {
  DEFAULT_NETWORK_HUB_SEEDS,
  DEFAULT_MAX_PEERS,
  MIN_FABRIC_PEER_PORT,
  MAX_FABRIC_PEER_PORT,
  parseFabricPeerPort,
  splitFabricHostPort,
  isNetworkHubAddress,
  isLoopbackFabricAddress,
  collectOwnFabricHosts,
  hostnameResolvesToOwn,
  primeOwnHostDns,
  isSelfFabricAddress,
  formatFabricHostPort,
  canonicalizeFabricPeerDial,
  isFabricAddress,
  normalizeFabricAddress,
  createIsKnownAppRelayType,
  clearOwnHostDnsCache
};
