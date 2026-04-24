'use strict';

const assert = require('assert');
const { acceptFirstHtmlNavigation } = require('../types/acceptNegotiation');
const { resolveAppAssetsDir } = require('../types/resolveAppAssetsDir');
const path = require('path');

describe('acceptNegotiation', function () {
  it('acceptFirstHtmlNavigation is true only for leading text/html', function () {
    assert.strictEqual(acceptFirstHtmlNavigation({ headers: { accept: 'text/html' } }), true);
    assert.strictEqual(acceptFirstHtmlNavigation({ headers: { accept: 'text/html, application/json' } }), true);
    assert.strictEqual(acceptFirstHtmlNavigation({ headers: { accept: 'application/json' } }), false);
    assert.strictEqual(acceptFirstHtmlNavigation({ headers: { accept: '*/*' } }), false);
    assert.strictEqual(acceptFirstHtmlNavigation({ headers: {} }), false);
  });
});

describe('resolveAppAssetsDir', function () {
  it('uses env as app root when set', function () {
    const envName = 'FABRIC_TEST_ASSETS_ROOT_X';
    const prev = process.env[envName];
    const root = path.join(__dirname, '..');
    process.env[envName] = root;
    try {
      const d = resolveAppAssetsDir(__dirname, { envVar: envName, subdir: 'types' });
      assert.strictEqual(d, path.join(root, 'types'));
    } finally {
      if (prev != null) process.env[envName] = prev;
      else delete process.env[envName];
    }
  });

  it('resolves ../assets from module dirname when env unset', function () {
    const envName = 'FABRIC_TEST_ASSETS_ROOT_MISSING';
    delete process.env[envName];
    const d = resolveAppAssetsDir(path.join(__dirname, '..', 'types'), { envVar: envName });
    assert.strictEqual(d, path.join(__dirname, '..', 'assets'));
  });
});
