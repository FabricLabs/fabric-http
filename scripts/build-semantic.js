'use strict';

// Rebuild this package's Semantic UI assets: the fabric theme (libraries/fomantic/src) compiled with
// the installed fomantic-ui into assets/. Commit the result; the Twemoji SVGs stay gitignored.
const { build } = require('../functions/semanticBuild');

build().catch((error) => {
  console.error('[fabric-http] Semantic build failed:', error && error.message ? error.message : error);
  process.exit(1);
});
