#!/usr/bin/env node
/**
 * Command-line HTTP server.
 */

// Settings
const settings = {
  assets: process.argv[2] || 'assets'
}; // TODO: read from file (Environment)

// Fabric Types
const HTTPServer = require('../types/server');

// Main Function
async function main (input = {}) {
  const server = new HTTPServer(input);
  await server.start();

  return {
    id: server.id,
    environment: environment.id
  };
}

// Run Process
main(settings).catch((exception) => {
  console.log('[HTTP:NODE]', 'Main Process Exception:', exception);
}).then((output) => {
  console.log('[HTTP:NODE]', 'Main Process Output:', output);
});

