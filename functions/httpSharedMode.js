'use strict';

/**
 * HTTP shared-mode bind helpers for Fabric nodes (Hub, LiveRelay, desktop).
 * Default local dashboard bind is loopback; LAN (`0.0.0.0`) is opt-in.
 */

/**
 * Whether persisted `httpSharedMode` / `HTTP_SHARED_MODE` means bind on all
 * interfaces (`0.0.0.0`).
 * @param {*} raw
 * @returns {boolean}
 */
function isHttpSharedModeEnabled (raw) {
  if (raw === undefined || raw === null) return false;
  if (raw === true || raw === 1) return true;
  if (typeof raw === 'string') {
    const s = raw.trim().toLowerCase();
    return s === 'true' || s === '1' || s === 'yes' || s === 'on';
  }
  return false;
}

/**
 * Resolve the HTTP listen host for a local dashboard / REST control plane.
 *
 * Defaults:
 * - `mode: 'server'` → `0.0.0.0` (hosted API)
 * - otherwise → `127.0.0.1` unless `httpSharedMode` is on
 *
 * Explicit `opts.envHost` / `opts.host` always wins. Env keys default to
 * Hub `FABRIC_HUB_INTERFACE` / GC `SC_HTTP_HOST` / `SC_HTTP_INTERFACE` when
 * `opts.envHost` is omitted and `opts.envHostKeys` is not set.
 *
 * @param {Object} [opts]
 * @param {string} [opts.mode] App mode (`relay` | `server` | …)
 * @param {*} [opts.httpSharedMode] persisted / constructor shared-mode flag
 * @param {string} [opts.host] constructor host override
 * @param {string} [opts.envHost] pre-resolved env override (tests)
 * @param {string[]} [opts.envHostKeys] env var names to check (first wins)
 * @param {NodeJS.ProcessEnv} [opts.env]
 * @returns {string}
 */
function resolveHttpListenHost (opts = {}) {
  const env = opts.env || process.env;
  if (opts.envHost != null) {
    const forced = String(opts.envHost).trim();
    if (forced) return forced;
  } else {
    const keys = Array.isArray(opts.envHostKeys) && opts.envHostKeys.length
      ? opts.envHostKeys
      : ['SC_HTTP_HOST', 'SC_HTTP_INTERFACE'];
    for (const key of keys) {
      const v = String(env[key] || '').trim();
      if (v) return v;
    }
  }

  const explicit = String(opts.host || '').trim();
  if (explicit) return explicit;

  if (String(opts.mode || '') === 'server') return '0.0.0.0';
  if (isHttpSharedModeEnabled(opts.httpSharedMode)) return '0.0.0.0';
  return '127.0.0.1';
}

module.exports = {
  isHttpSharedModeEnabled,
  resolveHttpListenHost
};
