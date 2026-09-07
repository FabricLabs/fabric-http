'use strict';

/**
 * Allowed Hub HTTP origins for fabric://login and fabric://link.
 * Prevents phishing URLs from soliciting a signed completion to an attacker hub.
 *
 * Defaults: **HTTPS** network hubs + loopback. Cleartext `http://` production
 * hubs are not default-trusted — add them via `FABRIC_HUB_ALLOWLIST` or
 * `opts.extra` when intentionally operating without TLS.
 *
 * Opt-in extras (same sources) may be:
 * - exact origins: `https://preview.example.com`
 * - HTTPS host suffixes: `*.example.com` (HTTPS only; suffix needs ≥2 DNS labels)
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
 * Normalize an HTTPS host-suffix token (`*.vercel.app` / `suffix:.vercel.app` / `.vercel.app`).
 * Rejects short public suffixes (e.g. `*.com`, `*.app`).
 * @param {string} raw
 * @returns {string|null} lowercase suffix including leading `.` (e.g. `.vercel.app`)
 */
function normalizeHttpsHostSuffix (raw) {
  let s = String(raw || '').trim().toLowerCase();
  if (!s) return null;
  if (s.startsWith('suffix:')) s = s.slice(7).trim();
  if (s.startsWith('*.')) s = s.slice(1);
  if (!s.startsWith('.')) s = `.${s}`;
  // Require at least two labels after the leading dot: `.vercel.app`
  const labels = s.slice(1).split('.').filter(Boolean);
  if (labels.length < 2) return null;
  if (!/^\.[a-z0-9.-]+$/.test(s)) return null;
  if (s.includes('..')) return null;
  return s;
}

/**
 * @param {string} token
 * @returns {{ kind: 'origin', origin: string }|{ kind: 'https-suffix', suffix: string }|null}
 */
function parseAllowlistToken (token) {
  const raw = String(token || '').trim();
  if (!raw) return null;
  const lower = raw.toLowerCase();
  if (lower.startsWith('*.') || lower.startsWith('suffix:') || (lower.startsWith('.') && !lower.includes('://'))) {
    const suffix = normalizeHttpsHostSuffix(raw);
    if (!suffix) return null;
    return { kind: 'https-suffix', suffix };
  }
  const origin = normalizeHubOrigin(raw);
  if (!origin) return null;
  return { kind: 'origin', origin };
}

/**
 * @param {string|string[]|null|undefined} raw
 * @returns {Array<{ kind: 'origin', origin: string }|{ kind: 'https-suffix', suffix: string }>}
 */
function parseAllowlistEntries (raw) {
  const parts = Array.isArray(raw)
    ? raw
    : String(raw || '').split(/[\s,]+/);
  const out = [];
  for (const part of parts) {
    const entry = parseAllowlistToken(part);
    if (entry) out.push(entry);
  }
  return out;
}

/**
 * @param {string} origin normalized `protocol://host`
 * @param {Array<{ kind: string, origin?: string, suffix?: string }>} entries
 * @returns {boolean}
 */
function originMatchesAllowlistEntries (origin, entries) {
  if (!origin || !Array.isArray(entries) || !entries.length) return false;
  let host = '';
  let isHttps = false;
  try {
    const u = new URL(origin);
    host = u.hostname.toLowerCase();
    isHttps = u.protocol === 'https:';
  } catch (_) {
    return false;
  }
  for (const entry of entries) {
    if (!entry || typeof entry !== 'object') continue;
    if (entry.kind === 'origin' && entry.origin === origin) return true;
    if (entry.kind === 'https-suffix' && isHttps && entry.suffix) {
      const suffix = entry.suffix;
      const bare = suffix.slice(1);
      if (host === bare || host.endsWith(suffix)) return true;
    }
  }
  return false;
}

/**
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {string[]} raw tokens (origins and optional `*.suffix`)
 */
function allowlistFromEnv (env = process.env) {
  const raw = env.FABRIC_HUB_ALLOWLIST || '';
  return String(raw).split(/[\s,]+/).map((s) => s.trim()).filter(Boolean);
}

/**
 * @param {string} hubBase
 * @param {Object} [opts]
 * @param {string[]} [opts.extra] Additional allowed origins or `*.suffix` tokens
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
  const entries = [
    ...parseAllowlistEntries(DEFAULT_FABRIC_HUB_ORIGINS),
    ...parseAllowlistEntries(allowlistFromEnv(env)),
    ...parseAllowlistEntries(opts.extra)
  ];
  return originMatchesAllowlistEntries(origin, entries);
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
      error: `hub origin not allowed: ${origin} (set FABRIC_HUB_ALLOWLIST or opts.extra; HTTPS suffixes via *.example.com)`
    };
  }
  return { ok: true, hubBase: origin };
}

module.exports = {
  DEFAULT_FABRIC_HUB_ORIGINS,
  CLEARTEXT_PRODUCTION_HUB_ORIGINS,
  normalizeHubOrigin,
  isLoopbackHubOrigin,
  normalizeHttpsHostSuffix,
  parseAllowlistToken,
  parseAllowlistEntries,
  originMatchesAllowlistEntries,
  allowlistFromEnv,
  isAllowedFabricHub,
  assertAllowedFabricHub
};
