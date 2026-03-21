#!/usr/bin/env node
/**
 * Command-line HTTP server — similar to `npx http-server [path] [options]`, with Fabric endpoints.
 *
 * Usage:
 *   fabric-http [path] [options]
 *   node scripts/node.js [path] [options]
 *
 * Options (subset aligned with http-server):
 *   -p, --port <n>       Port (default from settings / 9999)
 *   -a, --address <h>    Bind address (default 0.0.0.0)
 *   -c, --cache <sec>    Cache-Control max-age in seconds for static files (default 0)
 *   -S, --spa            Enable SPA fallback (serve index.html for extensionless GETs)
 *   --no-compression     Disable gzip (compression package)
 */

'use strict';

// Settings
const settings = require('../settings/local');
const { HTTP_SERVER_PORT } = require('../constants');

// Fabric Types
const Environment = require('@fabric/core/types/environment');
const HTTPServer = require('../types/server');

function parseArgs (argv) {
  const out = {
    positional: [],
    port: null,
    address: null,
    cacheSeconds: null,
    spa: false,
    compression: true
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '-p' || a === '--port') {
      out.port = Number(argv[++i]);
      continue;
    }
    if (a === '-a' || a === '--address' || a === '--host') {
      out.address = argv[++i];
      continue;
    }
    if (a === '-c' || a === '--cache') {
      out.cacheSeconds = Number(argv[++i]);
      continue;
    }
    if (a === '-S' || a === '--spa') {
      out.spa = true;
      continue;
    }
    if (a === '--no-compression') {
      out.compression = false;
      continue;
    }
    if (a.startsWith('-')) {
      console.warn('[FABRIC:HTTP]', 'Unknown flag (ignored):', a);
      continue;
    }
    out.positional.push(a);
  }
  return out;
}

// Read environment
const environment = new Environment();

// Main Function
async function main (input = {}) {
  const server = new HTTPServer(input);

  server.on('debug', (msg) => {
    console.debug('[FABRIC:HTTP]', '[DEBUG]', msg);
  });

  await server.start();

  return JSON.stringify({
    id: server.id,
    environment: environment.id,
    link: server.link
  });
}

environment.start();

const parsed = parseArgs(process.argv.slice(2));
const root = parsed.positional[0] || 'assets';

const input = Object.assign({}, settings, {
  assets: root,
  seed: environment.seed,
  xprv: environment.xprv
});

if (parsed.port != null && Number.isFinite(parsed.port)) input.port = parsed.port;
if (parsed.address) input.host = parsed.address;
if (parsed.cacheSeconds != null && Number.isFinite(parsed.cacheSeconds)) {
  input.static = Object.assign({}, settings.static || {}, { cacheSeconds: parsed.cacheSeconds });
}
if (parsed.spa) input.spaFallback = true;
if (parsed.compression === false) input.compression = false;
if (input.port == null && settings.port == null) input.port = HTTP_SERVER_PORT;

// Run Process
main(input).catch((exception) => {
  console.log('[FABRIC:HTTP]', 'Main Process Exception:', exception);
}).then((output) => {
  console.log('[FABRIC:HTTP]', 'Main Process Output:', output);
  console.log('[FABRIC:HTTP]', 'HTTP Server is running:', JSON.parse(output).link);
});
