'use strict';

const path = require('path');

/**
 * Root directory of the packaged Fomantic (fabric theme) static tree for this package:
 * `semantic.min.css`, `semantic.min.js`, `semantic.js`, `semantic*.css` (RTL), and `themes/.../fonts/`.
 * Produced by `npm run build:semantic` (`scripts/build-semantic.js`); path-absolute `url(/themes/...)`
 * is applied there for stable icon/text font resolution.
 * @returns {string}
 */
function fomanticAssetsDir () {
  return path.join(path.dirname(__dirname), 'assets');
}

module.exports = {
  fomanticAssetsDir
};
