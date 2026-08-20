'use strict';

/**
 * Parse `fabric://login?sessionId=…&hub=…` (and opaque rejects) for player login.
 * Shared by Electron main — keep free of Electron APIs for unit tests.
 */

const FABRIC_PROTOCOL = 'fabric';
const { assertAllowedFabricHub } = require('./fabricHubAllowlist');
const { applyPollSecretHeader } = require('./fabricSiteLoginVerify');

/**
 * @param {string} urlStr
 * @param {Object} [opts] Passed to {@link assertAllowedFabricHub} (env / extra allowlist)
 * @returns {{ ok: true, sessionId: string, hubBase: string } | { ok: false, error: string }}
 */
function parseFabricLoginUrl (urlStr, opts = {}) {
  if (typeof urlStr !== 'string' || !urlStr.trim()) {
    return { ok: false, error: 'empty url' };
  }
  let url;
  try {
    url = new URL(urlStr.trim());
  } catch (_) {
    return { ok: false, error: 'invalid url' };
  }
  if (url.protocol !== `${FABRIC_PROTOCOL}:`) {
    return { ok: false, error: 'not a fabric: url' };
  }
  // Opaque fabric:<hex> is message-only — not a login session.
  if (!url.hostname) {
    return { ok: false, error: 'opaque fabric: hex is not a login url' };
  }
  if (url.hostname !== 'login') {
    return { ok: false, error: `unknown fabric host: ${url.hostname}` };
  }
  const sessionId = (url.searchParams.get('sessionId') || '').trim();
  if (!sessionId || !/^[a-f0-9]{32,128}$/i.test(sessionId)) {
    return { ok: false, error: 'missing or invalid sessionId' };
  }
  const hubRaw = (url.searchParams.get('hub') || '').trim();
  if (!hubRaw) {
    return { ok: false, error: 'missing hub origin' };
  }
  let hubBase;
  try {
    const hubUrl = new URL(hubRaw);
    if (hubUrl.protocol !== 'http:' && hubUrl.protocol !== 'https:') {
      return { ok: false, error: 'hub must be http(s)' };
    }
    hubBase = `${hubUrl.protocol}//${hubUrl.host}`;
  } catch (_) {
    return { ok: false, error: 'invalid hub origin' };
  }
  const allowed = assertAllowedFabricHub(hubBase, opts);
  if (!allowed.ok) return allowed;
  return { ok: true, sessionId, hubBase: allowed.hubBase };
}

/**
 * Headers so remote hubs accept GET/POST the same way Hub desktop does
 * (Origin/Referer must match the session's declared origin off-loopback).
 * Pass `opts.pollSecret` from the create JSON for off-loopback signed redeem
 * (`X-Fabric-Poll-Secret`). Never copy that value into `fabric://` / QR.
 * @param {string} hubBase
 * @param {Object} [opts]
 * @param {string} [opts.pollSecret]
 * @returns {Record<string, string>}
 */
function fabricLoginRequestHeaders (hubBase, opts = {}) {
  const origin = String(hubBase || '').replace(/\/$/, '');
  const headers = {
    Accept: 'application/json',
    'Content-Type': 'application/json'
  };
  if (origin) {
    headers.Origin = origin;
    headers.Referer = `${origin}/`;
  }
  return applyPollSecretHeader(headers, opts && opts.pollSecret);
}

module.exports = {
  FABRIC_PROTOCOL,
  parseFabricLoginUrl,
  fabricLoginRequestHeaders
};
