const Bitcoin = require('@fabric/core/services/bitcoin');

async function main () {
  const bitcoin = new Bitcoin({
    verbosity: 3
  });

  await bitcoin.start();
}

main().catch((exception) => {
  console.error('[QUICKSTART]', 'Quick Start failed:', exception);
});
