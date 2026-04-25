'use strict';

const {
  P2P_SESSION_ACK
} = require('@fabric/core/constants');

// engine
const TICK_INTERVAL = 1000;
const SESSION_SEED = '79084a7963fc1761e8f6871d6aa704c4922316030af4aa5a076dde35fc0b6857';

// auth
const HTTP_IDENTITY_HEADER_NAME = 'X-Fabric-Identity';
const HTTP_SIGNATURE_HEADER_NAME = 'X-Fabric-Signature';
const HTTP_IDENTITY_HEADER_NAME_LOWER = HTTP_IDENTITY_HEADER_NAME.toLowerCase();
const HTTP_SIGNATURE_HEADER_NAME_LOWER = HTTP_SIGNATURE_HEADER_NAME.toLowerCase();

// http
const HTTP_CLIENT_PORT = 80;
const HTTP_SERVER_PORT = 9999;
const PREFERRED_CONTENT_TYPE = 'application/json';

// https
const HTTPS_CLIENT_PORT = 443;
const HTTPS_SERVER_PORT = 19999;

// websockets
const MAXIMUM_PING = 10000;
const WEBSOCKET_KEEPALIVE = 600000; // 10 minutes

// browser / dom
const BROWSER_TARGET = '#browser-content';

// Local dev: `scripts/sample-hub-http-server.js` (not a Fabric `HTTPServer` product type — tooling only).
// Hub and scripts probe `OPTIONS /` to avoid port clashes with a real @fabric/hub.
const SAMPLE_HUB_HTTP_SERVER_NAME = 'fabric-http-hub-local-stub';
const DEFAULT_SAMPLE_HUB_HTTP_PORT = 8099;

// exports (literals only — no functions; see FabricHTTPServer statics in `types/server.js`.)
module.exports = {
  TICK_INTERVAL,
  SESSION_SEED,
  HTTP_IDENTITY_HEADER_NAME,
  HTTP_SIGNATURE_HEADER_NAME,
  HTTP_IDENTITY_HEADER_NAME_LOWER,
  HTTP_SIGNATURE_HEADER_NAME_LOWER,
  HTTP_CLIENT_PORT,
  HTTP_SERVER_PORT,
  HTTPS_CLIENT_PORT,
  HTTPS_SERVER_PORT,
  MAXIMUM_PING,
  WEBSOCKET_KEEPALIVE,
  BROWSER_TARGET,
  P2P_SESSION_ACK,
  PREFERRED_CONTENT_TYPE,
  SAMPLE_HUB_HTTP_SERVER_NAME,
  DEFAULT_SAMPLE_HUB_HTTP_PORT
};
