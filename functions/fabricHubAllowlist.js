'use strict';

/**
 * Allowed Hub HTTP origins for fabric://login and fabric://link.
 * Prevents phishing URLs from soliciting a signed completion to an attacker hub.
 *
 * Defaults: **HTTPS** network hubs + loopback. Cleartext `http://` production
 * hubs are not default-trusted — add them via `FABRIC_HUB_ALLOWLIST` or
 * `opts.extra` when intentionally operating without TLS.
 */

const DEFAULT_FABRIC_HUB_ORIGINS = [
  'https://hub.fabric.pub',
  'https://relay.goon.vc',
  'https://goon.vc'
];

/** Cleartext production origins — opt-in only via FABRIC_HUB_ALLOWLIST / opts.extra. */
const CLEARTEXT_PRODUCTION_HUB_ORIGINS = [
  'http://hub.fabric.pub',
  'http://relay.goon.vc',
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
  // Explicit `opts.env` (even `{}`) replaces ambient process.env so tests / callers
  // can isolate allowlist overlays without leaking FABRIC_HUB_ALLOWLIST.
  const env = Object.prototype.hasOwnProperty.call(opts, 'env')
    ? (opts.env || {})
    : process.env;
  const allowed = new Set([
    ...DEFAULT_FABRIC_HUB_ORIGINS.map(normalizeHubOrigin).filter(Boolean),
    ...allowlistFromEnv(env),
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
  CLEARTEXT_PRODUCTION_HUB_ORIGINS,
  normalizeHubOrigin,
  isLoopbackHubOrigin,
  allowlistFromEnv,
  isAllowedFabricHub,
  assertAllowedFabricHub
};
