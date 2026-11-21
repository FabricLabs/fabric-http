'use strict';

/**
 * Browser origins allowed to open a WebSocket when an app does not set
 * `websocket.verifyOrigin`. A missing `Origin` is a non-browser client and
 * is allowed. A page on this host is allowed. Anything else must be one of
 * the pinned Passport origins (or `websocket.allowedOrigins`).
 */

/**
 * Canonical origin, or '' when `value` is not an absolute URL.
 * @param {*} value
 * @returns {string}
 * @private
 */
function normalizeOrigin (value) {
  const text = String(value || '').trim();
  if (!text) return '';
  try {
    return new URL(text).origin.toLowerCase();
  } catch (_) {
    return '';
  }
}

/**
 * @param {string[]|string} values
 * @returns {Set<string>}
 */
function originList (values) {
  const out = new Set();
  const list = Array.isArray(values) ? values : String(values || '').split(',');
  for (const item of list) {
    const origin = normalizeOrigin(item);
    if (origin) out.add(origin);
  }
  return out;
}

/**
 * @param {Object} [req]
 * @param {Set<string>} [allowed] Pinned origins, already normalized.
 * @returns {boolean}
 */
function webSocketOriginAllowed (req, allowed) {
  const headers = (req && req.headers) || {};
  const raw = headers.origin;
  if (raw == null || String(raw).trim() === '') return true;
  const origin = normalizeOrigin(raw);
  if (!origin) return false;
  if (allowed && allowed.has(origin)) return true;
  const host = String(headers.host || '').split(',')[0].trim().toLowerCase();
  try {
    if (host && new URL(origin).host.toLowerCase() === host) return true;
  } catch (_) {}
  return false;
}

module.exports = {
  normalizeOrigin,
  originList,
  webSocketOriginAllowed
};
