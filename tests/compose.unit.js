'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { JSDOM } = require('jsdom');

const { assertKnownComponents } = require('../functions/componentCatalog');
const { compose, composeFile, fillContentSlot, loadReferenceComponents } = require('../functions/compose');

const VIEWS = path.join(__dirname, '../views');

describe('compose', function () {
  it('escapes interpolated text', function () {
    const html = compose('h1 #{title}', { title: '<b>Hi</b>' }, {
      basedir: VIEWS,
      filename: path.join(VIEWS, 'inline.jade')
    });
    assert.ok(html.includes('<h1>&lt;b&gt;Hi&lt;/b&gt;</h1>'));
  });

  it('rejects unbuffered code', function () {
    assert.throws(() => compose('div\n  - const x = 1\n', {}, {
      basedir: VIEWS,
      filename: path.join(VIEWS, 'inline.jade')
    }), /unbuffered code/);
  });

  it('rejects unescaped interpolation', function () {
    assert.throws(() => compose('div\n  != name\n', { name: 'x' }, {
      basedir: VIEWS,
      filename: path.join(VIEWS, 'inline.jade')
    }), /unescaped interpolation/);
    assert.throws(() => compose('div !{name}\n', { name: 'x' }, {
      basedir: VIEWS,
      filename: path.join(VIEWS, 'inline.jade')
    }), /unescaped interpolation/);
  });

  it('rejects interpolation inside a script body', function () {
    const source = 'script(type="text/javascript").\n  var x = "#{title}";\n';
    assert.throws(() => compose(source, { title: 'nope' }, {
      basedir: VIEWS,
      filename: path.join(VIEWS, 'inline.jade')
    }), /script body/);
  });

  it('rejects an include outside basedir', function () {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fabric-compose-'));
    const basedir = path.join(root, 'views');
    fs.mkdirSync(basedir);
    fs.writeFileSync(path.join(root, 'secret.jade'), 'p hidden\n');
    fs.writeFileSync(path.join(basedir, 'page.jade'), 'include ../secret.jade\n');
    assert.throws(() => composeFile(path.join(basedir, 'page.jade'), {}, { basedir: basedir }), /outside basedir/);
  });

  it('places block scripts after the bundle script', function () {
    loadReferenceComponents();
    const html = composeFile(path.join(VIEWS, 'site.jade'), {
      title: 'Reference',
      language: 'en',
      bundleHash: 'abc'
    }, { basedir: VIEWS });
    const bundleAt = html.indexOf('/bundles/browser.min.js');
    const pageAt = html.indexOf('customElements.define');
    assert.ok(bundleAt > 0);
    assert.ok(pageAt > bundleAt);
  });

  it('resolves fabric-peer-list to the peer-list component', function () {
    loadReferenceComponents();
    const html = composeFile(path.join(VIEWS, 'client.jade'), {}, { basedir: VIEWS });
    assert.ok(html.includes('<fabric-peer-list>'));
    assert.ok(html.includes('Peers'));
    assert.ok(html.includes('data-slot="content"'));
    assert.ok(html.includes('<fabric-message-list>'));
    assert.ok(html.includes('History'));
  });

  it('fails unknown component tags', function () {
    assert.throws(() => compose('fabric-missing\n', {}, {
      basedir: VIEWS,
      filename: path.join(VIEWS, 'inline.jade')
    }), /Unknown component: fabric-missing/);
  });

  it('fills the content slot without removing history', function () {
    loadReferenceComponents();
    const html = composeFile(path.join(VIEWS, 'client.jade'), {}, { basedir: VIEWS });
    const dom = new JSDOM(html);
    const slot = fillContentSlot(dom.window.document, '<p>resource</p>');
    assert.ok(slot);
    assert.strictEqual(slot.querySelector('p').textContent, 'resource');
    assert.ok(dom.window.document.body.textContent.includes('History'));
    assert.ok(dom.window.document.body.textContent.includes('Peers'));
  });

  it('rejects unknown handles at define time', function () {
    loadReferenceComponents();
    assert.throws(() => assertKnownComponents({
      components: { list: 'example-list', view: 'example-view' }
    }), /Unknown component: example-list/);
    assert.doesNotThrow(() => assertKnownComponents({
      components: { list: 'fabric-resource-list', view: 'fabric-resource-view' }
    }));
  });
});
