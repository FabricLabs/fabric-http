'use strict';

// Settings
// const settings = require('../settings/default');
const settings = {};

// Types
// const Client = require('../types/client');

// Main Program
async function main (input) {
  if (!window) throw new Error('Must be run in a browser.');

  // Configuration
  const options = Object.assign({
    host: 'localhost',
    port: 9999,
    secure: false
  }, input);

  // Fabric Client
  /*
  const client = new Client(options);

  client.on('log', (msg) => {
    console.log('CLIENT LOG:', msg);
  });

  await client.start();

  // Fabric Global
  window.fabric = client;
  */

  // Result Map
  return {
    client: null // window.fabric.id
  };
}

// Execute Program
main(settings).catch((exception) => {
  console.error('[FABRIC:HTTP]', 'Main Process Error:', exception);
}).then((output) => {
  console.log('[FABRIC:HTTP]', 'Main Process Output:', output);
});
