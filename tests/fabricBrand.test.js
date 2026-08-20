'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const {
  FABRIC_BRAND_PURPLE,
  FABRIC_BRAND_FOREGROUND,
  FABRIC_BRAND_LETTER,
  fabricFaviconHeadHtml
} = require('../functions/fabricBrand');
const constants = require('../constants');
const SPA = require('../types/spa');

describe('fabricBrand', function () {
  // Coverage instrumentation can slow SPA bootstrap enough to hit Mocha's 2s default.
  this.timeout(15000);

  it('canonizes a white serif f on royal purple', function () {
    assert.strictEqual(FABRIC_BRAND_LETTER, 'f');
    assert.strictEqual(FABRIC_BRAND_FOREGROUND, '#FFFFFF');
    assert.strictEqual(FABRIC_BRAND_PURPLE, '#4C1D95');
    assert.strictEqual(constants.FABRIC_BRAND_PURPLE, FABRIC_BRAND_PURPLE);
  });

  it('emits favicon and theme-color head tags', function () {
    const html = fabricFaviconHeadHtml();
    assert.match(html, /href="\/favicon\.svg"/);
    assert.match(html, /href="\/favicon\.ico"/);
    assert.match(html, /apple-touch-icon\.png/);
    assert.match(html, new RegExp(`theme-color" content="${FABRIC_BRAND_PURPLE}"`));
  });

  it('includes those tags in the HTTP SPA document', function () {
    const spa = new SPA({ resources: {} });
    const doc = spa._renderWith('<p>ok</p>');
    assert.match(doc, /rel="icon" href="\/favicon\.svg"/);
    assert.match(doc, /rel="apple-touch-icon"/);
  });

  it('ships raster and vector assets for static HTTP', function () {
    const assets = path.join(__dirname, '..', 'assets');
    assert.ok(fs.existsSync(path.join(assets, 'favicon.svg')));
    assert.ok(fs.existsSync(path.join(assets, 'favicon.ico')));
    assert.ok(fs.existsSync(path.join(assets, 'apple-touch-icon.png')));
    assert.ok(fs.existsSync(path.join(assets, 'icons', 'icon-512.png')));
    assert.ok(fs.existsSync(path.join(assets, 'icons', 'icon-16.png')));
    const svg = fs.readFileSync(path.join(assets, 'favicon.svg'), 'utf8');
    assert.match(svg, /fill="#4C1D95"/);
    assert.match(svg, /<path fill="#FFFFFF"/);
  });
});
