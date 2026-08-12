'use strict';

/**
 * Allowed Hub HTTP origins for fabric://login and fabric://link.
 * Prevents phishing URLs from soliciting a signed completion to an attacker hub.
 *
 * Defaults: network hubs + loopback. Extra origins via FABRIC_HUB_ALLOWLIST —
 * comma-separated http(s) origins.
 */

const DEFAULT_FABRIC_HUB_ORIGINS = [
  'https://hub.fabric.pub',
  'http://hub.fabric.pub',
  'https://relay.goon.vc',
  'http://relay.goon.vc',
  'https://goon.vc',
  'http://goon.vc'
];

/**
 * @param {string} raw
 * @returns {string|null} `protocol://host` (no path) or null
 */
function normalizeHubOrigin (raw) {
  try {
    const u = new URL(String(raw || '').trim());
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    return `${u.protocol}//${u.host}`;
  } catch (_) {
    return null;
  }
}

function isLoopbackHubOrigin (origin) {
  try {
    const host = new URL(origin).hostname.toLowerCase();
    return host === 'localhost' || host === '127.0.0.1' || host === '[::1]' || host === '::1';
  } catch (_) {
    return false;
  }
}

/**
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {string[]}
 */
function allowlistFromEnv (env = process.env) {
  const raw = env.FABRIC_HUB_ALLOWLIST || '';
  return String(raw).split(',')
    .map((s) => normalizeHubOrigin(s))
    .filter(Boolean);
}

/**
 * @param {string} hubBase
 * @param {Object} [opts]
 * @param {string[]} [opts.extra] Additional allowed origins
 * @param {NodeJS.ProcessEnv} [opts.env]
 * @param {boolean} [opts.allowLoopback=true]
 * @returns {boolean}
 */
function isAllowedFabricHub (hubBase, opts = {}) {
  const origin = normalizeHubOrigin(hubBase);
  if (!origin) return false;
  if (opts.allowLoopback !== false && isLoopbackHubOrigin(origin)) return true;
  const allowed = new Set([
    ...DEFAULT_FABRIC_HUB_ORIGINS.map(normalizeHubOrigin).filter(Boolean),
    ...allowlistFromEnv(opts.env || process.env),
    ...(Array.isArray(opts.extra) ? opts.extra.map(normalizeHubOrigin).filter(Boolean) : [])
  ]);
  return allowed.has(origin);
}

/**
 * @param {string} hubBase
 * @param {Object} [opts]
 * @returns {{ ok: true, hubBase: string } | { ok: false, error: string }}
 */
function assertAllowedFabricHub (hubBase, opts = {}) {
  const origin = normalizeHubOrigin(hubBase);
  if (!origin) return { ok: false, error: 'invalid hub origin' };
  if (!isAllowedFabricHub(origin, opts)) {
    return {
      ok: false,
      error: `hub origin not allowed: ${origin} (set FABRIC_HUB_ALLOWLIST to add trusted hubs)`
    };
  }
  return { ok: true, hubBase: origin };
}

module.exports = {
  DEFAULT_FABRIC_HUB_ORIGINS,
  normalizeHubOrigin,
  isLoopbackHubOrigin,
  allowlistFromEnv,
  isAllowedFabricHub,
  assertAllowedFabricHub
};
