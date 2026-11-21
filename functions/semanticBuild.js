'use strict';

/**
 * @fileoverview The Fomantic UI (Semantic UI) toolchain for Fabric applications.
 *
 * `@fabric/http` keeps only the **fabric** theme layer (`libraries/fomantic/src/theme.config` and
 * `src/themes/fabric/`); everything else — definitions, the **default** theme, the Gulp tasks — comes
 * from the installed `fomantic-ui` package. An application needs no Semantic files of its own for the
 * defaults: {@link sync} copies the prebuilt CSS, JS, and theme assets this package ships. To customize,
 * an application adds only the Fomantic site files it changes under `semantic/site/` (for example
 * `semantic/site/globals/site.variables` with `@primaryColor: #663399;`), installs `fomantic-ui`, and
 * {@link build} compiles the fabric theme with those overrides on top. {@link run} picks between them.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { importTwemoji } = require('./twemoji');

const PACKAGE_ROOT = path.resolve(__dirname, '..');
const PACKAGE_ASSETS = path.join(PACKAGE_ROOT, 'assets');
const THEME_SOURCE = path.join(PACKAGE_ROOT, 'libraries', 'fomantic', 'src');
const THEME = 'fabric';
const SITE_DIRECTORY = path.join('semantic', 'site');

const COMPONENTS = [
  'reset', 'site', 'button', 'container', 'divider', 'emoji', 'flag', 'header', 'icon', 'image', 'input',
  'label', 'list', 'loader', 'rail', 'reveal', 'segment', 'step', 'text', 'breadcrumb', 'form', 'grid',
  'menu', 'message', 'table', 'ad', 'card', 'comment', 'feed', 'item', 'statistic', 'accordion',
  'calendar', 'checkbox', 'dimmer', 'dropdown', 'embed', 'flyout', 'modal', 'nag', 'placeholder', 'popup',
  'progress', 'slider', 'rating', 'search', 'shape', 'sidebar', 'sticky', 'tab', 'toast', 'transition',
  'api', 'state', 'visibility'
];

const ROOT_FILES = [
  'semantic.min.css',
  'semantic.css',
  'semantic.rtl.min.css',
  'semantic.rtl.css',
  'semantic.min.js',
  'semantic.js'
];

const SCRIPT_FILES = ROOT_FILES.filter((name) => name.endsWith('.js'));
const STYLE_FILES = ROOT_FILES.filter((name) => name.endsWith('.css'));

/** @private */
function copyFile (from, to) {
  if (!fs.existsSync(from)) return false;
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(from, to);
  return true;
}

/**
 * @private
 * Replace `<themes>/<name>` with `source`. `themes` may be a symlink (e.g. into `assets/styles`) and may
 * hold other themes, so only that one folder is replaced, at its real location.
 */
function replaceTheme (source, themes, name) {
  fs.mkdirSync(themes, { recursive: true });
  const target = path.join(fs.realpathSync(themes), name);
  if (path.resolve(source) === target) return;
  fs.rmSync(target, { recursive: true, force: true });
  fs.cpSync(source, target, { recursive: true });
}

/**
 * Every `node_modules` folder Node searches from `directory`, nearest first.
 * @private
 */
function nodeModulePaths (directory) {
  const paths = [];
  let dir = path.resolve(directory);
  for (;;) {
    if (path.basename(dir) !== 'node_modules') paths.push(path.join(dir, 'node_modules'));
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return paths;
}

/**
 * Locate the `fomantic-ui` package: the application's own install first, then the one installed with
 * `@fabric/http`.
 * @param {string} [root] Application root.
 * @returns {string|null} Absolute path of the `fomantic-ui` package, or null.
 */
function resolveFomantic (root = process.cwd()) {
  for (const base of [root, PACKAGE_ROOT]) {
    try {
      return path.dirname(require.resolve('fomantic-ui/package.json', { paths: [base] }));
    } catch (_) { /* not installed there */ }
  }
  return null;
}

/**
 * Find resources the Semantic CSS in `assets` loads that are remote (CDN fonts, Twemoji on jsDelivr, …)
 * or missing from `assets`.
 * @param {string} assets Folder holding `semantic*.css`.
 * @returns {string[]} One line per problem; empty when every resource is local and present.
 */
function checkCssResources (assets) {
  const root = path.resolve(assets);
  const problems = new Set();
  for (const name of STYLE_FILES) {
    const cssPath = path.join(root, name);
    if (!fs.existsSync(cssPath)) continue;
    const css = fs.readFileSync(cssPath, 'utf8');
    for (const match of css.matchAll(/url\(\s*(['"]?)([^'")]+)\1\s*\)/g)) {
      const ref = match[2].trim();
      if (ref.startsWith('data:') || ref.startsWith('#')) continue;
      if (/^([a-z][a-z0-9+.-]*:|\/\/)/i.test(ref)) {
        problems.add(`${name}: external resource ${ref}`);
        continue;
      }
      const file = path.resolve(root, ref.split(/[?#]/)[0]);
      if (!file.startsWith(root + path.sep) || !fs.existsSync(file)) {
        problems.add(`${name}: missing ${ref}`);
      }
    }
  }
  return [...problems];
}

/**
 * Lay out a Fomantic build directory: `fomantic-ui`'s sources and Gulp tasks, the fabric theme over
 * them, the application's site overrides (only the files it has), and a `semantic.json`.
 * @param {Object} options
 * @param {string} options.fomantic Path of the `fomantic-ui` package.
 * @param {string} options.stage Empty directory to fill.
 * @param {string} [options.site] Application `site/` folder with Fomantic site overrides.
 * @returns {string} The stage directory.
 */
function stage ({ fomantic, stage: dir, site }) {
  const src = path.join(dir, 'src');
  const upstream = path.join(fomantic, 'src');
  const version = String(require(path.join(fomantic, 'package.json')).version).split('+')[0];

  // Fomantic finds semantic.json by walking up from its own tasks/, so the tasks are copied, not linked.
  fs.cpSync(path.join(fomantic, 'tasks'), path.join(dir, 'tasks'), { recursive: true });
  fs.copyFileSync(path.join(fomantic, 'gulpfile.js'), path.join(dir, 'gulpfile.js'));
  fs.mkdirSync(src, { recursive: true });
  for (const name of ['semantic.less', 'theme.less', 'overrides.less']) {
    fs.copyFileSync(path.join(upstream, name), path.join(src, name));
  }
  fs.cpSync(path.join(upstream, 'definitions'), path.join(src, 'definitions'), { recursive: true });
  // The fabric theme carries its own fonts; the default theme's would ship unused.
  const defaultAssets = path.join(upstream, 'themes', 'default', 'assets');
  fs.cpSync(path.join(upstream, 'themes', 'default'), path.join(src, 'themes', 'default'), {
    recursive: true,
    filter: (from) => from !== defaultAssets && !from.startsWith(defaultAssets + path.sep)
  });

  const twemoji = path.join(THEME_SOURCE, 'themes', THEME, 'assets', 'twemoji');
  fs.cpSync(path.join(THEME_SOURCE, 'themes', THEME), path.join(src, 'themes', THEME), {
    recursive: true,
    filter: (from) => from !== twemoji && !from.startsWith(twemoji + path.sep)
  });
  fs.copyFileSync(path.join(THEME_SOURCE, 'theme.config'), path.join(src, 'theme.config'));

  fs.cpSync(path.join(upstream, '_site'), path.join(src, 'site'), { recursive: true });
  if (site) fs.cpSync(site, path.join(src, 'site'), { recursive: true });

  fs.writeFileSync(path.join(dir, 'semantic.json'), JSON.stringify({
    base: '',
    paths: {
      source: {
        config: 'src/theme.config',
        definitions: 'src/definitions/',
        site: 'src/site/',
        themes: 'src/themes/'
      },
      output: {
        packaged: 'dist/',
        uncompressed: 'dist/components/',
        compressed: 'dist/components/',
        themes: 'dist/themes/'
      },
      clean: 'dist/'
    },
    permission: false,
    autoInstall: false,
    rtl: 'both',
    components: COMPONENTS,
    version
  }, null, 2) + '\n');
  return dir;
}

/**
 * Run Fomantic's `build` task in a stage, resolving its dependencies the way `fomantic-ui` would.
 * @private
 */
function runGulp (dir, fomantic) {
  const gulpfile = path.join(dir, 'gulpfile.js');
  const nodePath = [path.join(fomantic, 'node_modules'), ...nodeModulePaths(fomantic), process.env.NODE_PATH]
    .filter(Boolean)
    .join(path.delimiter);
  const runner = [
    'const gulpfile = process.argv[1];',
    "const gulp = require(require('module').createRequire(gulpfile).resolve('gulp'));",
    'require(gulpfile);',
    "gulp.series('build')((error) => { if (error) { console.error(error); process.exit(1); } });"
  ].join('\n');
  const result = spawnSync(process.execPath, ['-e', runner, gulpfile], {
    cwd: dir,
    env: { ...process.env, NODE_PATH: nodePath },
    stdio: 'inherit'
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`Fomantic build exited with ${result.status}`);
}

/**
 * Copy Semantic assets from a source laid out like this package's `assets/` into `to`: the root
 * `semantic*` files, `scripts/semantic*.js`, `styles/semantic*.css` files `to` already has, and each
 * theme folder.
 * @private
 */
function publish (from, to, themes) {
  for (const name of ROOT_FILES) copyFile(path.join(from.root, name), path.join(to, name));
  for (const name of SCRIPT_FILES) copyFile(path.join(from.root, name), path.join(to, 'scripts', name));
  for (const name of STYLE_FILES) {
    const target = path.join(to, 'styles', name);
    if (fs.existsSync(target)) copyFile(path.join(from.root, name), target);
  }
  for (const name of themes) replaceTheme(path.join(from.themes, name), path.join(to, 'themes'), name);
}

/**
 * Import Twemoji into `assets` and fail on any CSS resource that is remote or missing.
 * @private
 */
async function finish (assets, { log, twemoji }) {
  if (twemoji === false) return checkOrThrow(assets, (line) => !line.includes('/twemoji/'));
  const destination = path.join(assets, 'themes', THEME, 'assets', 'twemoji');
  const { tag, count, skipped } = await importTwemoji(destination);
  log(`[fabric-http] Twemoji ${tag}: ${count} SVGs ${skipped ? 'already in' : 'imported into'} ${destination}`);
  checkOrThrow(assets);
}

/** @private */
function checkOrThrow (assets, keep = () => true) {
  const problems = checkCssResources(assets).filter(keep);
  if (problems.length > 0) {
    throw new Error(`${problems.length} CSS resource(s) are not in ${assets}:\n${problems.slice(0, 20).join('\n')}`);
  }
}

/**
 * Compile the fabric theme with Fomantic, plus the application's site overrides when it has any, into
 * `output`. Needs `fomantic-ui` installed (the application's, else `@fabric/http`'s).
 * @param {Object} [options]
 * @param {string} [options.root] Application root (default: this package).
 * @param {string|false} [options.site] Site overrides folder (default `<root>/semantic/site` when present).
 * @param {string} [options.output] Assets folder to write (default `<root>/assets`).
 * @param {Function} [options.log] Logger (default `console.log`).
 * @param {boolean} [options.twemoji] `false` skips importing (and checking for) the Twemoji SVGs.
 * @returns {Promise<{ output: string, fomantic: string, site: string|null }>}
 */
async function build (options = {}) {
  const root = path.resolve(options.root || PACKAGE_ROOT);
  const output = path.resolve(options.output || path.join(root, 'assets'));
  const log = options.log || console.log;
  const defaultSite = path.join(root, SITE_DIRECTORY);
  const site = options.site === false
    ? null
    : (options.site ? path.resolve(options.site) : (fs.existsSync(defaultSite) ? defaultSite : null));

  const fomantic = resolveFomantic(root);
  if (!fomantic) {
    throw new Error('fomantic-ui is not installed. Customizing the Semantic theme needs it: npm i -D fomantic-ui');
  }
  if (site && !fs.statSync(site).isDirectory()) throw new Error(`Not a folder: ${site}`);

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fabric-semantic-'));
  try {
    log(`[fabric-http] Fomantic ${fomantic}${site ? ` with site overrides from ${site}` : ''}`);
    stage({ fomantic, stage: dir, site });
    runGulp(dir, fomantic);

    const dist = path.join(dir, 'dist');
    if (!fs.existsSync(path.join(dist, 'semantic.min.css'))) {
      throw new Error('Fomantic reported success but dist/semantic.min.css is missing.');
    }
    // Ship the theme's font binaries exactly as committed, whatever Gulp did to them.
    const distAssets = path.join(dist, 'themes', THEME, 'assets');
    fs.rmSync(distAssets, { recursive: true, force: true });
    fs.cpSync(path.join(dir, 'src', 'themes', THEME, 'assets'), distAssets, { recursive: true });

    const themes = fs.readdirSync(path.join(dist, 'themes'), { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
    publish({ root: dist, themes: path.join(dist, 'themes') }, output, themes);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }

  await finish(output, { log, twemoji: options.twemoji });
  log(`[fabric-http] Semantic build → ${output}`);
  return { output, fomantic, site };
}

/**
 * Copy the prebuilt Semantic assets this package ships (fabric theme, no overrides) into `to`.
 * @param {Object} options
 * @param {string} options.to Application assets folder.
 * @param {string} [options.from] Source assets folder (default: this package's `assets/`).
 * @param {Function} [options.log] Logger (default `console.log`).
 * @param {boolean} [options.twemoji] `false` skips importing (and checking for) the Twemoji SVGs.
 * @returns {Promise<{ to: string, copied: boolean }>}
 */
async function sync (options = {}) {
  if (!options.to) throw new Error('sync needs a destination folder (to)');
  const to = path.resolve(options.to);
  const from = path.resolve(options.from || PACKAGE_ASSETS);
  const log = options.log || console.log;
  if (!fs.existsSync(path.join(from, 'semantic.min.css'))) {
    throw new Error(`No prebuilt Semantic assets in ${from}`);
  }
  if (!fs.existsSync(path.join(from, 'themes', THEME))) throw new Error(`No "${THEME}" theme in ${from}`);
  if (from === to) return { to, copied: false };

  publish({ root: from, themes: path.join(from, 'themes') }, to, [THEME]);
  await finish(to, { log, twemoji: options.twemoji });
  log(`[fabric-http] Semantic assets ${from} → ${to}`);
  return { to, copied: true };
}

/**
 * Build when the application has site overrides (`<root>/semantic/site`), otherwise copy the prebuilt
 * assets. This is the `fabric-http-semantic` command.
 * @param {Object} [options]
 * @param {string} [options.root] Application root (default `process.cwd()`).
 * @param {string} [options.output] Assets folder (default `<root>/assets`).
 * @param {Function} [options.log] Logger (default `console.log`).
 * @param {boolean} [options.twemoji] `false` skips importing (and checking for) the Twemoji SVGs.
 * @returns {Promise<Object>} The result of {@link build} or {@link sync}.
 */
async function run (options = {}) {
  const root = path.resolve(options.root || process.cwd());
  const output = path.resolve(options.output || path.join(root, 'assets'));
  if (root === PACKAGE_ROOT || fs.existsSync(path.join(root, SITE_DIRECTORY))) {
    return build({ ...options, root, output });
  }
  return sync({ ...options, to: output });
}

module.exports = {
  COMPONENTS,
  SITE_DIRECTORY,
  THEME,
  build,
  checkCssResources,
  resolveFomantic,
  run,
  stage,
  sync
};
