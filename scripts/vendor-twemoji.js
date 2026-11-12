'use strict';

/**
 * Import the pinned Twemoji SVGs (`functions/twemoji.js`) into `assets/themes/fabric/assets/twemoji/`.
 * `npm run build:semantic` already does this; run it alone to refresh the images without a Gulp build.
 */
const path = require('path');
const { importTwemoji } = require('../functions/twemoji');

const root = path.resolve(__dirname, '..');
const destination = path.join(root, 'assets', 'themes', 'fabric', 'assets', 'twemoji');

importTwemoji(destination).then(({ tag, count, skipped }) => {
  console.log(`[vendor-twemoji] Twemoji ${tag}: ${count} SVGs ${skipped ? 'already in' : 'written to'} ${path.relative(root, destination)}`);
}).catch((err) => {
  console.error('[vendor-twemoji]', err.message || err);
  process.exit(1);
});
