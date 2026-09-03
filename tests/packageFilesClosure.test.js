'use strict';

/**
 * `files[]` must be *closed* under internal requires: shipping `types/browser.js`
 * without `components/browser-content.js` produces a package that resolves fine
 * in this repo and throws `MODULE_NOT_FOUND` the moment a consumer installs it.
 *
 * That is not hypothetical. `@fabric/hub` CI went red on exactly this: its
 * lockfile pinned http at `ca27d1472`, whose `files[]` had no
 * `components/**` glob, so `require('../components/browser-content')` from
 * `types/browser.js` failed inside `scripts/build.js`. Local `npm test` and
 * local `npm pack` were both green the whole time, because the file is tracked
 * in git — it simply was not packed. `components/**\/*.js` was added later.
 *
 * `tests/packageExports.test.js` covers the declared `exports` subpaths. This
 * suite covers the transitive tail behind them: every relative require of a
 * packed module must itself be packed.
 */

const assert = require('assert');
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

/** Directories whose packed JS is worth walking. `assets/**` is bundled output. */
const SOURCE_PREFIXES = ['types/', 'functions/', 'services/', 'middlewares/', 'components/', 'contracts/'];

/** Ask npm which files actually ship. Authoritative: honours `files[]` + `.npmignore`. */
function packedPaths () {
  const raw = execFileSync('npm', ['pack', '--dry-run', '--json'], {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'ignore']
  });
  const parsed = JSON.parse(raw.trim());
  // `--json` shape is npm-version dependent: an array of package objects on
  // older npm, a map keyed by package name on newer. Accept either.
  const packages = Array.isArray(parsed) ? parsed : Object.values(parsed);
  const files = [];
  for (const entry of packages) for (const f of (entry.files || [])) files.push(f.path);
  return new Set(files.map((p) => p.replace(/\\/g, '/')));
}

/** Strip comments so commented-out requires are not treated as real edges. */
function stripComments (src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:\\])\/\/[^\n]*/g, '$1');
}

/** Resolve a relative require to a repo-relative path, mirroring CJS resolution. */
function resolveRelative (fromFile, request) {
  const base = path.resolve(path.dirname(path.join(ROOT, fromFile)), request);
  const candidates = [base, `${base}.js`, `${base}.json`, path.join(base, 'index.js')];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
      return path.relative(ROOT, candidate).replace(/\\/g, '/');
    }
  }
  return null;
}

describe('package files[] closure', function () {
  this.timeout(120000);

  let packed;

  before(function () {
    try {
      packed = packedPaths();
    } catch (exception) {
      const code = exception && exception.code;
      const msg = String((exception && exception.message) || '');
      // Without npm on PATH this cannot be checked; skip rather than pass.
      if (code === 'ENOENT' || /spawn npm/i.test(msg)) {
        this.skip();
        return;
      }
      throw exception;
    }
  });

  it('packs a plausible file set', function () {
    assert.ok(packed.size > 100, `expected a substantial package, saw ${packed.size} files`);
    assert.ok(packed.has('types/browser.js'), 'types/browser.js should ship');
  });

  it('packs every relative require reachable from a packed module', function () {
    const sources = [...packed].filter(
      (p) => p.endsWith('.js') && SOURCE_PREFIXES.some((prefix) => p.startsWith(prefix))
    );
    assert.ok(sources.length > 50, `expected 50+ packed source modules, saw ${sources.length}`);

    const missing = [];
    const unresolved = [];

    for (const file of sources) {
      const src = stripComments(fs.readFileSync(path.join(ROOT, file), 'utf8'));
      for (const match of src.matchAll(/require\(\s*['"](\.[^'"]*)['"]\s*\)/g)) {
        const request = match[1];
        const target = resolveRelative(file, request);
        if (!target) {
          // Broken even in-repo: report separately from a packaging gap.
          unresolved.push(`${file} -> ${request}`);
          continue;
        }
        if (!packed.has(target)) missing.push(`${file} -> ${request}  (resolves to ${target}, NOT packed)`);
      }
    }

    assert.deepStrictEqual(
      unresolved,
      [],
      `relative requires that do not resolve in-repo:\n  ${unresolved.join('\n  ')}`
    );
    assert.deepStrictEqual(
      missing,
      [],
      `packed modules requiring unpacked files (breaks on install):\n  ${missing.join('\n  ')}`
    );
  });
});
