'use strict';

const Hub = require('../types/hub');

async function main () {
  const hub = new Hub();
  await hub.start();
}

main().catch((E) => {
  console.error('[SCRIPTS:HUB]', 'Hub threw exception:', E);
});
