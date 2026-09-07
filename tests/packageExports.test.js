'use strict';

/**
 * The `exports` map in `package.json` is the supported entry surface: Hub,
 * GoonCitizen, Passport, and the browser extension all reach in through these
 * subpaths. Nothing in the suite loads every one of them, so a subpath can rot
 * (renamed file, dropped `files[]` glob, shim pointing at a package that no
 * longer exists) and still ship green — the same failure mode as the dead
 * `shims/noble-secp256k1.js` found in `@fabric/hub`, which threw
 * MODULE_NOT_FOUND on every load while CI stayed green because nothing
 * required it.
 *
 * Require each declared CommonJS subpath so that class of breakage fails here
 * instead of in a downstream install.
 */

const assert = require('assert');
const path = require('path');
const pkg = require('../package.json');

// `./module.js` is the deliberate ESM entry; `require()` of it is expected to
// fail, so it is not part of the CommonJS contract under test.
const ESM_ONLY = new Set(['./module.js']);

describe('package exports surface', function () {
  const declared = Object.entries(pkg.exports || {})
    .filter(([subpath]) => !subpath.includes('*'))
    .filter(([subpath]) => !ESM_ONLY.has(subpath));

  it('declares a non-trivial export map', function () {
    // Guard the guard: if `exports` were emptied or reshaped, the loop below
    // would vacuously pass.
    assert.ok(declared.length >= 30, `expected 30+ CommonJS subpaths, saw ${declared.length}`);
    assert.strictEqual(pkg.exports['.'], './types/web.js');
  });

  it('resolves every declared CommonJS subpath to a loadable module', function () {
    const failures = [];
    for (const [subpath, target] of declared) {
      try {
        const loaded = require(path.join(__dirname, '..', target));
        if (loaded == null) failures.push(`${subpath} -> ${target} (loaded but empty)`);
      } catch (exception) {
        failures.push(`${subpath} -> ${target} (${exception.code || 'ERROR'}: ${exception.message})`);
      }
    }
    assert.deepStrictEqual(failures, [], `unloadable export subpaths:\n  ${failures.join('\n  ')}`);
  });

  it('ships every declared export target under a files[] glob', function () {
    // A subpath that resolves in the repo but is not packaged breaks only for
    // installed consumers, which is the hardest version of this bug to see.
    const globs = pkg.files || [];
    const covered = (target) => {
      const rel = target.replace(/^\.\//, '');
      const top = rel.split('/')[0];
      return globs.some((g) => {
        if (g.startsWith('!')) return false;
        if (g === rel) return true;
        const gTop = g.split('/')[0];
        return gTop === top && g.includes('*');
      });
    };
    const unpacked = declared
      .map(([, target]) => target)
      .filter((target) => !covered(target));
    assert.deepStrictEqual(unpacked, [], `export targets missing from files[]:\n  ${unpacked.join('\n  ')}`);
  });
});
