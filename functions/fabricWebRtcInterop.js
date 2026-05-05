'use strict';

/**
 * Shared constants and helpers for Hub page ↔ extension mesh registration and
 * Hub HTTP(S) base URL → WebSocket signaling URL conversion.
 *
 * These values are intentionally aligned with deployed Hub + extension behavior.
 */

/** `window.postMessage` source tag used by Hub pages. */
const FABRIC_HUB_POSTMESSAGE_SOURCE = 'fabric-hub';
/** Hub page asks extension/content script to register background mesh. */
const FABRIC_HUB_REGISTER_MESH = 'FABRIC_HUB_REGISTER_MESH';
/** Hub page asks extension/content script to unregister background mesh. */
const FABRIC_HUB_UNREGISTER_MESH = 'FABRIC_HUB_UNREGISTER_MESH';
/** Signal metadata protocol tag used by browser-side WebRTC envelopes. */
const FABRIC_WEBRTC_SIGNAL_PROTOCOL = 'fabric-webrtc-v2';

/** WebRTC peer-registry RPC method names handled by HTTP JSON-RPC / WebSocket JSONCall. */
const WEBRTC_REGISTRY_METHODS = Object.freeze([
  'RegisterWebRTCPeer',
  'UnregisterWebRTCPeer',
  'ListWebRTCPeers'
]);

/**
 * @param {unknown} methodName
 * @returns {boolean}
 */
function isWebRtcRegistryMethod (methodName) {
  return WEBRTC_REGISTRY_METHODS.includes(String(methodName || ''));
}

/**
 * Parse a Hub address string and normalize to WS signaling origin.
 *
 * @param {string} input Hub base URL or host[:port]
 * @returns {{ host: string, port: number, secure: boolean, wsOrigin: string, raw: string }|null}
 */
function parseFabricHubAddress (input) {
  try {
    const raw = input == null ? '' : String(input).trim();
    if (!raw) return null;

    const hasScheme = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(raw);
    const url = new URL(hasScheme ? raw : `https://${raw}`);

    const proto = (url.protocol || '').replace(':', '');
    const secure = proto === 'https' || proto === 'wss';
    const host = url.hostname;
    const port = url.port ? Number(url.port) : (secure ? 443 : 80);
    if (!host || !port || Number.isNaN(port)) return null;

    const wsOrigin = (secure ? 'wss' : 'ws') + `://${host}:${port}`;
    return { host, port, secure, wsOrigin, raw };
  } catch (_) {
    return null;
  }
}

/**
 * Build Hub signaling WebSocket URL from base Hub address.
 *
 * @param {string} hubAddress
 * @param {string} [path='/']
 * @returns {string|null}
 */
function fabricSignalingWebSocketUrl (hubAddress, path = '/') {
  const p = parseFabricHubAddress(hubAddress);
  if (!p) return null;
  const s = String(path == null ? '/' : path);
  const pathNorm = s.startsWith('/') ? s : `/${s}`;
  return `${p.wsOrigin}${pathNorm}`;
}

/**
 * Derive canonical browser origin from a Hub address.
 *
 * @param {string} hubAddress
 * @returns {string|null}
 */
function expectedOriginFromHubAddress (hubAddress) {
  try {
    const raw = String(hubAddress == null ? '' : hubAddress).trim();
    if (!raw) return null;
    const hasScheme = /^https?:\/\//i.test(raw);
    const u = new URL(hasScheme ? raw : `https://${raw}`);
    return u.origin || null;
  } catch (_) {
    return null;
  }
}

/**
 * Validate page origin ownership for Hub mesh registration requests.
 *
 * @param {string} hubAddress
 * @param {string} pageOrigin
 * @returns {boolean}
 */
function isHubPageOriginMatch (hubAddress, pageOrigin) {
  const expected = expectedOriginFromHubAddress(hubAddress);
  if (!expected) return false;
  return String(pageOrigin || '') === expected;
}

/**
 * Build canonical register message for `window.postMessage`.
 * @param {string} hubAddress
 */
function buildFabricHubRegisterMeshMessage (hubAddress) {
  return {
    source: FABRIC_HUB_POSTMESSAGE_SOURCE,
    type: FABRIC_HUB_REGISTER_MESH,
    hubAddress: String(hubAddress)
  };
}

/**
 * Build canonical unregister message for `window.postMessage`.
 */
function buildFabricHubUnregisterMeshMessage () {
  return {
    source: FABRIC_HUB_POSTMESSAGE_SOURCE,
    type: FABRIC_HUB_UNREGISTER_MESH
  };
}

/**
 * Attach monotonic Fabric WebRTC signaling metadata to a payload.
 *
 * @template T
 * @param {{ localSessionId: string, remoteSessionId: string|null, localSignalRevision: number }} session
 * @param {T} payload
 * @returns {T & { _fabric: { protocol: string, sessionId: string, targetSessionId: string|null, revision: number } }}
 */
function attachFabricSignalMeta (session, payload) {
  session.localSignalRevision += 1;
  return Object.assign({}, payload, {
    _fabric: {
      protocol: FABRIC_WEBRTC_SIGNAL_PROTOCOL,
      sessionId: session.localSessionId,
      targetSessionId: session.remoteSessionId,
      revision: session.localSignalRevision
    }
  });
}

module.exports = {
  FABRIC_HUB_POSTMESSAGE_SOURCE,
  FABRIC_HUB_REGISTER_MESH,
  FABRIC_HUB_UNREGISTER_MESH,
  FABRIC_WEBRTC_SIGNAL_PROTOCOL,
  WEBRTC_REGISTRY_METHODS,
  isWebRtcRegistryMethod,
  parseFabricHubAddress,
  fabricSignalingWebSocketUrl,
  expectedOriginFromHubAddress,
  isHubPageOriginMatch,
  buildFabricHubRegisterMeshMessage,
  buildFabricHubUnregisterMeshMessage,
  attachFabricSignalMeta
};
