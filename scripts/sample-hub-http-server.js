#!/usr/bin/env node
'use strict';

/**
 * Minimal @fabric/http server aligned with a local Hub / extension workflow:
 * - CORS on (browser fetches with Authorization to POST /services/rpc)
 * - JSON-RPC on POST /services/rpc (optional bearer via jsonRpc.requireAuth)
 * - Static tree from examples/hub-local-dev-assets (hub-mesh-bridge.html)
 *
 * Default listen: 127.0.0.1:8099 — **not** 8080, so a real @fabric/hub (see hub.fabric.pub) can use 8080.
 * Override: PORT=8080 node scripts/sample-hub-http-server.js to align with a Hub on the same port.
 */

const path = require('path');
const HTTPServer = require('../types/server');
const {
  SAMPLE_HUB_HTTP_SERVER_NAME,
  DEFAULT_SAMPLE_HUB_HTTP_PORT
} = require('../constants');

const host = process.env.HOST || '127.0.0.1';
const port = Number(process.env.PORT != null && String(process.env.PORT).trim() !== '' ? process.env.PORT : DEFAULT_SAMPLE_HUB_HTTP_PORT);

const requireAuth =
  process.env.FABRIC_JSONRPC_REQUIRE_AUTH === '1' ||
  process.env.FABRIC_JSONRPC_REQUIRE_AUTH === 'true';

const tokenSecret = process.env.FABRIC_HTTP_TOKEN_SECRET || null;

const assetsRoot = path.join(__dirname, '..', 'examples', 'hub-local-dev-assets');

const server = new HTTPServer({
  name: SAMPLE_HUB_HTTP_SERVER_NAME,
  host,
  hostname: host,
  interface: host,
  port,
  listen: true,
  assets: assetsRoot,
  cors: true,
  jsonRpc: {
    enabled: true,
    paths: ['/services/rpc'],
    requireAuth: requireAuth && Boolean(tokenSecret)
  },
  ...(tokenSecret ? { tokenSecret } : {})
});

server._registerMethod('HubStubPing', function () {
  return { ok: true, from: 'sample-hub-http-server' };
});

async function main () {
  await server.start();
  console.log(`[fabric-http] Hub local stub — http://${host}:${port}/`);
  console.log(`[fabric-http] mesh bridge page: http://${host}:${port}/hub-mesh-bridge.html`);
  console.log(`[fabric-http] JSON-RPC: POST /services/rpc (method HubStubPing)`);
  if (requireAuth && tokenSecret) {
    console.log('[fabric-http] JSON-RPC requires bearer (FABRIC_HTTP_TOKEN_SECRET set, FABRIC_JSONRPC_REQUIRE_AUTH=1)');
  } else {
    console.log('[fabric-http] JSON-RPC auth: off (set FABRIC_JSONRPC_REQUIRE_AUTH=1 and FABRIC_HTTP_TOKEN_SECRET=… to test bearer)');
  }
}

main().catch((err) => {
  console.error('[fabric-http] sample server failed:', err);
  process.exit(1);
});

async function shutdown () {
  try {
    await server.stop();
  } catch (err) {
    console.error('[fabric-http] shutdown error:', err);
  } finally {
    process.exit(0);
  }
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
