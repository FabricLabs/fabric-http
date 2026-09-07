'use strict';

/**
 * @fileoverview Canonical Fabric lettermark: serif lowercase **f** (Arvo) in white
 * on a rich royal purple field. Used for favicons and desktop / extension icons.
 */

/** Rich royal purple — icon background and `theme-color`. */
const FABRIC_BRAND_PURPLE = '#4C1D95';

/** Lettermark foreground. */
const FABRIC_BRAND_FOREGROUND = '#FFFFFF';

/** Public letter shown in the mark. */
const FABRIC_BRAND_LETTER = 'f';

/**
 * HTML `<head>` tags for the Fabric favicon set served from HTTPServer static roots
 * (`/favicon.ico`, `/favicon.svg`, `/apple-touch-icon.png` in package `assets/`).
 *
 * @param {Object} [options]
 * @param {string} [options.indent] Whitespace inserted before every line after the first.
 * @returns {string}
 */
function fabricFaviconHeadHtml (options) {
  const indent = options && options.indent != null ? String(options.indent) : '    ';
  const lines = [
    '<link rel="icon" href="/favicon.ico" sizes="48x48">',
    '<link rel="icon" href="/favicon.svg" type="image/svg+xml">',
    '<link rel="apple-touch-icon" href="/apple-touch-icon.png">',
    `<meta name="theme-color" content="${FABRIC_BRAND_PURPLE}">`
  ];
  return lines.join('\n' + indent);
}

module.exports = {
  FABRIC_BRAND_PURPLE,
  FABRIC_BRAND_FOREGROUND,
  FABRIC_BRAND_LETTER,
  fabricFaviconHeadHtml
};
