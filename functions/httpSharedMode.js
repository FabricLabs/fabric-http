'use strict';

/**
 * HTTP shared-mode bind helpers for Fabric nodes (Hub, LiveRelay, desktop).
 * Default local dashboard bind is loopback; LAN (`0.0.0.0`) is opt-in.
 *
 * Canonical env (Fabric-wide — no app prefixes):
 *   FABRIC_HUB_INTERFACE | INTERFACE | FABRIC_HTTP_INTERFACE
 *
 * App-specific aliases belong at the app boundary, not in this module.
 */

/** Default env keys consulted for HTTP listen host (first non-empty wins). */
const DEFAULT_HTTP_LISTEN_ENV_KEYS = Object.freeze([
  'FABRIC_HUB_INTERFACE',
  'INTERFACE',
  'FABRIC_HTTP_INTERFACE'
]);

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
 * {@link DEFAULT_HTTP_LISTEN_ENV_KEYS} unless `opts.envHostKeys` is set.
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
  // Explicit constructor overrides beat inherited env (envHost wins over host).
  if (opts.envHost != null) {
    const forced = String(opts.envHost).trim();
    if (forced) return forced;
  }

  const explicit = String(opts.host || '').trim();
  if (explicit) return explicit;

  const keys = Array.isArray(opts.envHostKeys) && opts.envHostKeys.length
    ? opts.envHostKeys
    : DEFAULT_HTTP_LISTEN_ENV_KEYS;
  for (const key of keys) {
    const v = String(env[key] || '').trim();
    if (v) return v;
  }

  if (String(opts.mode || '') === 'server') return '0.0.0.0';
  if (isHttpSharedModeEnabled(opts.httpSharedMode)) return '0.0.0.0';
  return '127.0.0.1';
}

/**
 * When HTTP is shared (`0.0.0.0`), require WebSocket client tokens unless the
 * operator explicitly set `websocket.requireClientToken: false`.
 *
 * Fail-closed: shared bind turns `requireClientToken` on even when
 * `FABRIC_WS_CLIENT_TOKEN` is unset (handshakes reject until a token is
 * configured). When the env token is present, it fills `websocket.clientToken`
 * if settings left it empty.
 *
 * @param {object} [settings]
 * @param {object} [opts]
 * @param {boolean} [opts.bindAll] shared bind active
 * @param {NodeJS.ProcessEnv} [opts.env]
 * @returns {object} settings (possibly cloned with websocket gate)
 */
function applySharedModeWebsocketGate (settings = {}, opts = {}) {
  if (!opts.bindAll) return settings;
  const env = opts.env || process.env;
  const ws = Object.assign({}, settings.websocket || {});
  const explicitOff = ws.requireClientToken === false ||
    ws.requireClientToken === 0 ||
    ws.requireClientToken === '0';
  if (explicitOff) return settings;
  ws.requireClientToken = true;
  const envTok = String(env.FABRIC_WS_CLIENT_TOKEN || '').trim();
  if (envTok && !ws.clientToken) ws.clientToken = envTok;
  return Object.assign({}, settings, { websocket: ws });
}

module.exports = {
  DEFAULT_HTTP_LISTEN_ENV_KEYS,
  isHttpSharedModeEnabled,
  resolveHttpListenHost,
  applySharedModeWebsocketGate
};
