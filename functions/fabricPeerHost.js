'use strict';

/**
 * Fabric peer address helpers shared by Hub, LiveRelay, and light peer hosts.
 * App-specific CONTRACT_MESSAGE catalogs stay injectable via
 * {@link createIsKnownAppRelayType}.
 */

const DEFAULT_NETWORK_HUB_SEEDS = Object.freeze([
  'hub.fabric.pub:7777',
  'relay.goon.vc:7777'
]);

/** Default TCP peer cap (matches @fabric/core MAX_PEERS soft default for slot fill). */
const DEFAULT_MAX_PEERS = 32;

/** @type {Map<string, boolean>} */
const _dnsOwnHostCache = new Map();

/**
 * True when address is a known network hub seed host (selective Fabric relays).
 * @param {*} address
 * @returns {boolean}
 */
function isNetworkHubAddress (address) {
  const host = String(address || '').trim().toLowerCase().split(':')[0];
  return host === 'hub.fabric.pub' || host === 'relay.goon.vc';
}

/**
 * True when address uses a loopback host (localhost / 127.0.0.1 / ::1).
 * @param {*} address
 * @returns {boolean}
 */
function isLoopbackFabricAddress (address) {
  const host = String(address || '').trim().toLowerCase().split(':')[0];
  return host === 'localhost' || host === '127.0.0.1' || host === '[::1]' || host === '::1';
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
    let s = String(raw || '').trim().toLowerCase();
    if (!s) return;
    if (s.startsWith('[') && s.includes(']')) {
      s = s.slice(1, s.indexOf(']'));
    } else if (/:\d{1,5}$/.test(s) && (s.match(/:/g) || []).length === 1) {
      s = s.split(':')[0];
    }
    if (s) hosts.add(s);
  };
  if (opts.advertiseHost) add(opts.advertiseHost);
  for (const h of opts.ownHosts || []) add(h);
  const env = opts.env || process.env;
  for (const key of ['FABRIC_PUBLIC_HOST', 'FABRIC_ADVERTISE_HOST', 'SC_FABRIC_PUBLIC_HOST']) {
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
  if (_dnsOwnHostCache.has(key)) return _dnsOwnHostCache.get(key);
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
  _dnsOwnHostCache.set(key, hit);
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
  const host = String(address || '').trim().toLowerCase().split(':')[0];
  if (!host) return false;

  if (isLoopbackFabricAddress(address)) {
    const port = Number(String(address || '').trim().split(':')[1]);
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
 * True when `value` looks like a Fabric peer address (`host:port`).
 * @param {*} value
 * @returns {boolean}
 */
function isFabricAddress (value) {
  const s = String(value || '').trim();
  if (!s || /^https?:\/\//i.test(s)) return false;
  return /^[a-zA-Z0-9._-]+(?::\d{1,5})$/.test(s);
}

/**
 * Normalize operator input to `host:port`.
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
      return `${u.hostname}:7777`;
    } catch (_) {
      return null;
    }
  }
  return null;
}

/**
 * Build a predicate for known application CONTRACT_MESSAGE body types.
 * Apps supply their catalog (GoonCitizen Group, Mission, … types); host stays generic.
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
