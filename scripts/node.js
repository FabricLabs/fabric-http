#!/usr/bin/env node
/**
 * Command-line HTTP server.
 */

// Settings
const settings = require('../settings/local');

// Fabric Types
const Environment = require('@fabric/core/types/environment');
const HTTPServer = require('../types/server');

// Read environment
const environment = new Environment();

// Main Function
async function main (input = {}) {
  const server = new HTTPServer(input);
  await server.start();

  return JSON.stringify({
    id: server.id,
    environment: environment.id,
    link: server.link
  });
}

environment.start();

const input = Object.assign(settings, {
  assets: process.argv[2] || 'assets',
  seed: environment.seed,
  xprv: environment.xprv
});

// Run Process
main(input).catch((exception) => {
  console.log('[FABRIC:HTTP]', 'Main Process Exception:', exception);
}).then((output) => {
  console.log('[FABRIC:HTTP]', 'Main Process Output:', output);
  console.log('[FABRIC:HTTP]', 'HTTP Server is running:', JSON.parse(output).link);
});

