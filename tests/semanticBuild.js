'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const semantic = require('../functions/semanticBuild');

function write (file, content = '') {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

/** A stand-in `fomantic-ui` package with just the layout `stage` reads. */
function fakeFomantic (dir) {
  write(path.join(dir, 'package.json'), JSON.stringify({ name: 'fomantic-ui', version: '2.10.0-beta.129+abc' }));
  write(path.join(dir, 'gulpfile.js'), '// gulpfile');
  write(path.join(dir, 'tasks', 'config', 'user.js'), '// user');
  for (const name of ['semantic.less', 'theme.less', 'overrides.less']) write(path.join(dir, 'src', name));
  write(path.join(dir, 'src', 'definitions', 'elements', 'button.less'));
  write(path.join(dir, 'src', 'themes', 'default', 'globals', 'site.variables'), '@primaryColor: @blue;');
  write(path.join(dir, 'src', 'themes', 'default', 'assets', 'fonts', 'Lato-Regular.woff2'));
  write(path.join(dir, 'src', '_site', 'globals', 'site.variables'), '/* boilerplate */');
  write(path.join(dir, 'src', '_site', 'elements', 'button.overrides'), '/* boilerplate */');
  return dir;
}

describe('functions/semanticBuild', function () {
  let tmp;

  beforeEach(function () {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'semantic-test-'));
  });

  afterEach(function () {
    this.timeout(60000);
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  describe('stage', function () {
    it('lays out fomantic-ui, the fabric theme, and a sparse site over the boilerplate', function () {
      const fomantic = fakeFomantic(path.join(tmp, 'fomantic-ui'));
      const site = path.join(tmp, 'app', 'semantic', 'site');
      write(path.join(site, 'globals', 'site.variables'), '@primaryColor: #663399;');
      const dir = path.join(tmp, 'stage');
      fs.mkdirSync(dir);

      semantic.stage({ fomantic, stage: dir, site });

      assert.ok(!fs.lstatSync(path.join(dir, 'tasks')).isSymbolicLink(), 'tasks must be copied');
      assert.ok(fs.existsSync(path.join(dir, 'tasks', 'config', 'user.js')));
      assert.ok(fs.existsSync(path.join(dir, 'gulpfile.js')));
      assert.ok(fs.existsSync(path.join(dir, 'src', 'definitions', 'elements', 'button.less')));
      assert.ok(fs.existsSync(path.join(dir, 'src', 'themes', 'default', 'globals', 'site.variables')));
      assert.ok(!fs.existsSync(path.join(dir, 'src', 'themes', 'default', 'assets')), 'default fonts are not shipped');
      assert.ok(fs.existsSync(path.join(dir, 'src', 'themes', 'fabric', 'globals', 'site.variables')));
      assert.ok(fs.existsSync(path.join(dir, 'src', 'themes', 'fabric', 'assets', 'fonts', 'icons.woff2')));
      assert.ok(!fs.existsSync(path.join(dir, 'src', 'themes', 'fabric', 'assets', 'twemoji')));
      assert.ok(fs.readFileSync(path.join(dir, 'src', 'theme.config'), 'utf8').includes("@site       : 'fabric'"));

      assert.strictEqual(fs.readFileSync(path.join(dir, 'src', 'site', 'globals', 'site.variables'), 'utf8'), '@primaryColor: #663399;');
      assert.strictEqual(fs.readFileSync(path.join(dir, 'src', 'site', 'elements', 'button.overrides'), 'utf8'), '/* boilerplate */');

      const config = JSON.parse(fs.readFileSync(path.join(dir, 'semantic.json'), 'utf8'));
      assert.strictEqual(config.version, '2.10.0-beta.129');
      assert.strictEqual(config.paths.source.site, 'src/site/');
      assert.deepStrictEqual(config.components, semantic.COMPONENTS);
      assert.strictEqual(new Set(config.components).size, config.components.length);
    });

    it('uses the boilerplate site when the application has no overrides', function () {
      const fomantic = fakeFomantic(path.join(tmp, 'fomantic-ui'));
      const dir = path.join(tmp, 'stage');
      fs.mkdirSync(dir);
      semantic.stage({ fomantic, stage: dir });
      assert.strictEqual(fs.readFileSync(path.join(dir, 'src', 'site', 'globals', 'site.variables'), 'utf8'), '/* boilerplate */');
    });
  });

  describe('sync', function () {
    function fakeAssets (dir) {
      for (const name of ['semantic.min.css', 'semantic.css', 'semantic.min.js', 'semantic.js']) {
        write(path.join(dir, name), `/* ${name} */`);
      }
      write(path.join(dir, 'themes', 'fabric', 'assets', 'fonts', 'icons.woff2'), 'new');
      return dir;
    }

    it('copies root files and scripts, refreshes only existing styles, and replaces only the fabric theme', async function () {
      const from = fakeAssets(path.join(tmp, 'from'));
      const to = path.join(tmp, 'to');
      write(path.join(to, 'styles', 'themes', 'default', 'keep.txt'), 'keep');
      write(path.join(to, 'styles', 'themes', 'fabric', 'stale.txt'), 'stale');
      write(path.join(to, 'styles', 'semantic.css'), 'old');
      fs.symlinkSync('styles/themes', path.join(to, 'themes'));

      const result = await semantic.sync({ from, to, twemoji: false, log: () => {} });

      assert.strictEqual(result.copied, true);
      assert.strictEqual(fs.readFileSync(path.join(to, 'semantic.min.css'), 'utf8'), '/* semantic.min.css */');
      assert.strictEqual(fs.readFileSync(path.join(to, 'scripts', 'semantic.min.js'), 'utf8'), '/* semantic.min.js */');
      assert.strictEqual(fs.readFileSync(path.join(to, 'styles', 'semantic.css'), 'utf8'), '/* semantic.css */');
      assert.ok(!fs.existsSync(path.join(to, 'styles', 'semantic.min.css')), 'styles/ files are refreshed, not added');
      assert.ok(fs.lstatSync(path.join(to, 'themes')).isSymbolicLink(), 'the themes link survives');
      assert.strictEqual(fs.readFileSync(path.join(to, 'styles', 'themes', 'default', 'keep.txt'), 'utf8'), 'keep');
      assert.ok(!fs.existsSync(path.join(to, 'styles', 'themes', 'fabric', 'stale.txt')));
      assert.strictEqual(fs.readFileSync(path.join(to, 'themes', 'fabric', 'assets', 'fonts', 'icons.woff2'), 'utf8'), 'new');
    });

    it('does nothing when source and destination are the same folder', async function () {
      const from = fakeAssets(path.join(tmp, 'from'));
      const result = await semantic.sync({ from, to: from, twemoji: false, log: () => {} });
      assert.strictEqual(result.copied, false);
      assert.ok(fs.existsSync(path.join(from, 'themes', 'fabric', 'assets', 'fonts', 'icons.woff2')));
    });

    it('fails on CSS that loads a remote or missing resource', async function () {
      const from = fakeAssets(path.join(tmp, 'from'));
      write(path.join(from, 'semantic.css'), 'a{background:url(https://cdn.example/x.png)} b{background:url("themes/fabric/missing.svg")}');
      await assert.rejects(
        semantic.sync({ from, to: path.join(tmp, 'to'), twemoji: false, log: () => {} }),
        /2 CSS resource\(s\)/
      );
    });

    it('refuses a source without prebuilt assets', async function () {
      await assert.rejects(semantic.sync({ from: tmp, to: path.join(tmp, 'to'), twemoji: false }), /No prebuilt Semantic assets/);
    });
  });

  describe('checkCssResources', function () {
    it('accepts data URIs, fragments, and local files', function () {
      write(path.join(tmp, 'themes', 'fabric', 'a.woff2'));
      write(path.join(tmp, 'semantic.css'), 'a{src:url(data:font/woff2;base64,AA)} b{fill:url(#g)} c{src:url("themes/fabric/a.woff2?v=1")}');
      assert.deepStrictEqual(semantic.checkCssResources(tmp), []);
    });

    it('accepts the CSS this package ships', function () {
      const assets = path.join(__dirname, '..', 'assets');
      const problems = semantic.checkCssResources(assets).filter((line) => !line.includes('/twemoji/'));
      assert.deepStrictEqual(problems, []);
    });
  });

  describe('run', function () {
    it('copies the prebuilt assets when the application has no semantic/site', async function () {
      this.timeout(120000);
      const root = path.join(tmp, 'app');
      fs.mkdirSync(root);
      const result = await semantic.run({ root, twemoji: false, log: () => {} });
      assert.strictEqual(result.copied, true);
      assert.ok(fs.existsSync(path.join(root, 'assets', 'semantic.min.css')));
      assert.ok(fs.existsSync(path.join(root, 'assets', 'themes', 'fabric', 'assets', 'fonts', 'icons.woff2')));
    });
  });

  it('finds the fomantic-ui installed with @fabric/http', function () {
    const found = semantic.resolveFomantic(tmp);
    if (!found) this.skip();
    assert.strictEqual(require(path.join(found, 'package.json')).name, 'fomantic-ui');
  });
});
