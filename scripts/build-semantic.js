'use strict';

/**
 * Fabric UI semantic build: run Fomantic `gulp build` in `libraries/fomantic`, then mirror
 * `dist/` into `assets/` (root CSS/JS + `themes/` for icon fonts and Arvo).
 *
 * The **fabric** theme source is under `libraries/fomantic/src/themes/fabric/`. It should match
 * `@fabric/hub`’s `libraries/semantic/src/themes/fabric/` (e.g. `rsync -a hub/.../themes/fabric/
 * libraries/fomantic/src/themes/fabric/`) so page colors (e.g. @pageBackground) and font binaries
 * stay in sync, then re-run this script and commit the resulting `assets/`.
 *
 * **Installed as a dependency** (e.g. Hub after `npm i`): this package has no `libraries/`; if prebuilt
 * `assets/semantic.min.css` is present, this script exits 0 and does not run Gulp. Rebuilds require
 * a full fabric-http clone (or `npm link`) with `libraries/fomantic`.
 */
const path = require('path');
const { spawnSync } = require('child_process');
const fs = require('fs');

const root = path.resolve(__dirname, '..');
const fomanticDir = path.join(root, 'libraries', 'fomantic');
const fomanticGulpfile = path.join(fomanticDir, 'gulpfile.js');
const shippedSemantic = path.join(root, 'assets', 'semantic.min.css');
const fomanticPkg = path.join(root, 'node_modules', 'fomantic-ui');

/**
 * Gulp is required for `libraries/fomantic`’s Gulpfile. It may live in this package’s `node_modules`,
 * under `fomantic-ui`’s tree, or be hoisted to a parent (e.g. `hub/node_modules` when @fabric/http is linked).
 * @returns {string|null} Absolute path to `gulp.js`, or null.
 */
function findGulpBin (startRoot) {
  const relative = [
    ['node_modules', 'gulp', 'bin', 'gulp.js'],
    ['node_modules', 'fomantic-ui', 'node_modules', 'gulp', 'bin', 'gulp.js']
  ];
  let dir = startRoot;
  for (let depth = 0; depth < 5; depth++) {
    for (const segs of relative) {
      const candidate = path.join(dir, ...segs);
      if (fs.existsSync(candidate)) return candidate;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  try {
    const pkg = require.resolve('gulp/package.json', { paths: [startRoot, fomanticPkg] });
    const p = path.join(path.dirname(pkg), 'bin', 'gulp.js');
    if (fs.existsSync(p)) return p;
  } catch (_) { /* not installed */ }
  return null;
}

if (!fs.existsSync(fomanticGulpfile)) {
  if (fs.existsSync(shippedSemantic)) {
    console.log(
      '[fabric-http] No ./libraries/fomantic (omitted in the published package). Using shipped assets/semantic.min.css and themes/ — no Gulp run.'
    );
    process.exit(0);
  }
  console.error(
    '[fabric-http] No Fomantic sources and no shipped semantic.min.css. Expected ./libraries/fomantic/gulpfile.js or assets/ from the package. ' +
    'Clone the fabric-http repository, run `npm install` and `npm run build:semantic` there, or `npm link` a local @fabric/http.'
  );
  process.exit(1);
}

const gulpBin = findGulpBin(root);
if (!gulpBin) {
  console.error(
    '[fabric-http] gulp CLI not found. From the fabric-http package root run: npm install (devDependencies: gulp, fomantic-ui). ' +
    'If this tree is linked into an app, install dev deps in the linked @fabric/http checkout.'
  );
  process.exit(1);
}

const rootModules = path.join(root, 'node_modules');

const nodePath = [rootModules, process.env.NODE_PATH || ''].filter(Boolean).join(path.delimiter);
const env = { ...process.env, NODE_PATH: nodePath };

console.log('[fabric-http] Gulp CLI:', gulpBin);
console.log('[fabric-http] Fomantic cwd:', fomanticDir);

const build = spawnSync(process.execPath, [gulpBin, 'build'], { cwd: fomanticDir, env, stdio: 'inherit' });
if (build.error) {
  console.error('[fabric-http] gulp spawn failed:', build.error);
  process.exit(1);
}
if (build.status == null || build.status !== 0) {
  process.exit(build.status == null ? 1 : build.status);
}

const dist = path.join(fomanticDir, 'dist');
const distMain = path.join(dist, 'semantic.min.css');
if (!fs.existsSync(distMain)) {
  console.error('[fabric-http] Gulp reported success but dist/semantic.min.css is missing.');
  process.exit(1);
}
const srcThemes = path.join(fomanticDir, 'src', 'themes');
const distThemes = path.join(dist, 'themes');
const fabricThemeSrc = path.join(srcThemes, 'fabric');
const fabricThemeDist = path.join(distThemes, 'fabric');

/** Gulp copies into dist but does not remove deleted theme folders — drop orphans vs src/themes. */
function pruneOrphanDistThemes () {
  if (!fs.existsSync(distThemes) || !fs.existsSync(srcThemes)) return;
  for (const ent of fs.readdirSync(distThemes, { withFileTypes: true })) {
    if (!ent.isDirectory()) continue;
    if (!fs.existsSync(path.join(srcThemes, ent.name))) {
      fs.rmSync(path.join(distThemes, ent.name), { recursive: true, force: true });
    }
  }
}
pruneOrphanDistThemes();

/**
 * Preserve canonical Fabric theme assets from source.
 *
 * Fomantic build steps can rewrite or replace theme asset binaries in dist/. For @fabric/http we
 * treat `libraries/fomantic/src/themes/fabric/assets` as the canonical source of icon and Arvo
 * font files that should be shipped to consumers (Hub, extension, etc.).
 */
function syncFabricThemeAssetsFromSource () {
  const srcAssets = path.join(fabricThemeSrc, 'assets');
  const distAssets = path.join(fabricThemeDist, 'assets');
  if (!fs.existsSync(srcAssets)) return;
  fs.mkdirSync(fabricThemeDist, { recursive: true });
  fs.rmSync(distAssets, { recursive: true, force: true });
  fs.cpSync(srcAssets, distAssets, { recursive: true });
}
syncFabricThemeAssetsFromSource();

const assetsScripts = path.join(root, 'assets', 'scripts');
const assetsStyles = path.join(root, 'assets', 'styles');
const assetsThemes = path.join(root, 'assets', 'themes');

function copyPattern (pattern, destDir) {
  const names = fs.readdirSync(dist).filter((n) => pattern.test(n));
  for (const n of names) {
    fs.copyFileSync(path.join(dist, n), path.join(destDir, n));
  }
}

fs.mkdirSync(assetsScripts, { recursive: true });
fs.mkdirSync(assetsStyles, { recursive: true });
fs.mkdirSync(assetsThemes, { recursive: true });

copyPattern(/\.js$/i, assetsScripts);
copyPattern(/\.css$/i, assetsStyles);

const themesSrc = path.join(dist, 'themes');
if (fs.existsSync(themesSrc)) {
  fs.rmSync(assetsThemes, { recursive: true, force: true });
  fs.cpSync(themesSrc, assetsThemes, { recursive: true });
}

const assetsRoot = path.join(root, 'assets');
function copyIfExists (fromPath, toPath) {
  if (fs.existsSync(fromPath)) fs.copyFileSync(fromPath, toPath);
}

copyIfExists(path.join(assetsStyles, 'semantic.min.css'), path.join(assetsRoot, 'semantic.min.css'));
copyIfExists(path.join(assetsStyles, 'semantic.css'), path.join(assetsRoot, 'semantic.css'));
copyIfExists(path.join(assetsScripts, 'semantic.min.js'), path.join(assetsRoot, 'semantic.min.js'));
copyIfExists(path.join(assetsScripts, 'semantic.js'), path.join(assetsRoot, 'semantic.js'));
copyIfExists(path.join(assetsStyles, 'semantic.rtl.min.css'), path.join(assetsRoot, 'semantic.rtl.min.css'));
copyIfExists(path.join(assetsStyles, 'semantic.rtl.css'), path.join(assetsRoot, 'semantic.rtl.css'));

/* Gulp output uses `url(themes/...)` relative to `/semantic.min.css` — no post-processing. `themes/fabric/`
   paths come from `src/themes/fabric/globals/site.variables` (`@fontPath` / `@imagePath`). */
console.log('[fabric-http] Fomantic dist → assets/scripts, assets/styles, assets/themes, assets/*.semantic*');
