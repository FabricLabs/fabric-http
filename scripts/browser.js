'use strict';

// Types
const Client = require('../types/client');

// Main Program
async function main () {
  if (!window) throw new Error('Must be run in a browser.');

  try {
    window.fabric = new Client({ authority: 'hub.fabric.pub' });
    await window.fabric.start();
  } catch (exception) {
    this.emit('error', exception);
  }

  return {
    fabric: window.fabric.id
  };
}

// Execute Program
main().catch((exception) => {
  console.error('[FABRIC:HTTP]', 'Main Process Error:', exception);
}).then((output) => {
  console.log('[FABRIC:HTTP]', 'Main Process Output:', output);
});
