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

/**
 * True when `host` is not an IP literal and DNS resolves it to a local interface.
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
  // Remaining: prefer async dns.promises.lookup (Node 24 deprecates lookupSync).
  const cacheKey = `${key}|${[...ownHosts].sort().join(',')}`;
  if (_dnsOwnHostCache.has(cacheKey)) return _dnsOwnHostCache.get(cacheKey);
  let hit = false;
  try {
    const dns = require('dns');
    if (typeof dns.lookupSync === 'function') {
      const r = dns.lookupSync(key, { all: true });
      const list = Array.isArray(r) ? r : (r ? [r] : []);
      for (const row of list) {
        const addr = row && (row.address || row);
        if (addr && ownHosts.has(String(addr).toLowerCase())) {
          hit = true;
          break;
        }
      }
    }
  } catch (_) {
    hit = false;
  }
  _dnsOwnHostCache.set(cacheKey, hit);
  return hit;
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
  isSelfFabricAddress,
  isFabricAddress,
  normalizeFabricAddress,
  createIsKnownAppRelayType,
  clearOwnHostDnsCache
};
