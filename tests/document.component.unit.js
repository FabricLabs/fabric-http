'use strict';

const assert = require('assert');
const path = require('path');

const { compose, loadReferenceComponents } = require('../functions/compose');
const { assertKnownComponents } = require('../functions/componentCatalog');
const Document = require('@fabric/core/types/document');

const VIEWS = path.join(__dirname, '../views');

describe('fabric-document component', function () {
  let FabricDocument;

  before(function () {
    this.timeout(20000);
    loadReferenceComponents();
    FabricDocument = require('../components/document');
  });

  it('is a known handle usable as a resource view', function () {
    assert.doesNotThrow(() => assertKnownComponents({
      components: { list: 'fabric-resource-list', view: 'fabric-document' }
    }));
  });

  it('composes core Document#compile output into the layout content slot', async function () {
    const doc = Document.seal(Buffer.alloc(5000, 7), { chunkBytes: 2048, documentId: 'demo' });
    const src = await doc.compile(['layout.jade', 'fabric-document']);
    const html = compose(src, { title: 'x', language: 'en', bundleHash: 'h' }, {
      basedir: VIEWS,
      filename: path.join(VIEWS, 'inline.jade')
    });
    assert.ok(html.includes('<div id="application-target"><fabric-document'));
    assert.ok(html.includes(`data-merkle-root="${doc.merkleRootHex}"`));
    assert.ok(html.indexOf('/bundles/browser.min.js') > html.indexOf('<fabric-document'));
  });

  it('renders a hash-only record with ranked offers and never leaks names', function () {
    const doc = Document.seal(Buffer.alloc(5000, 7), { chunkBytes: 2048, documentId: 'demo' });
    const record = doc.record();
    const leaf0 = record.blobs[0].blobHashHex;
    const offers = [
      { sellerId: 'slow', blobHashHex: leaf0, rateSats: 1, latencyMs: 400, peerScore: 500, name: 'secret.pdf' },
      { sellerId: 'fast', blobHashHex: leaf0, rateSats: 3, latencyMs: 20, peerScore: 900 },
      { sellerId: 'other', blobHashHex: record.blobs[1].blobHashHex, rateSats: 2, latencyMs: 5, peerScore: 700 }
    ];
    const component = new FabricDocument({ document: record, offers: offers });
    const html = component._getInnerHTML(component.state);

    assert.ok(html.includes(doc.merkleRootHex.slice(0, 8)));
    assert.ok(html.includes('data-blob-index="0"'));
    assert.ok(html.includes('data-blob-index="2"'));
    assert.ok(html.includes('data-action="_buyBlob"'));
    assert.ok(!html.includes('secret.pdf'), 'offer metadata must not render');

    const ranked = FabricDocument.offersForBlob(offers, leaf0).map((o) => o.sellerId);
    assert.deepStrictEqual(ranked, ['fast', 'slow']);

    // Opened blobs swap the buy button for an unlocked marker.
    component._setOpened({ blobs: [0], manifest: { title: 'Readable Title' } });
    const opened = component._getInnerHTML(component.state);
    assert.ok(opened.includes('Readable Title'));
    assert.ok(opened.includes('1/3 opened'));
  });

  it('defines the Document resource on a server', async function () {
    this.timeout(20000);
    const os = require('os');
    const net = require('net');
    const HTTPServer = require('../types/server');
    const port = await new Promise((resolve, reject) => {
      const s = net.createServer();
      s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); });
      s.on('error', reject);
    });
    const server = new HTTPServer({
      port,
      host: '127.0.0.1',
      interface: '127.0.0.1',
      hostname: '127.0.0.1',
      listen: true,
      accessLog: require('path').join(os.tmpdir(), `fabric-http-doc-${port}.log`),
      resources: { Document: FabricDocument.resource }
    });
    await server.start();
    try {
      const entry = server.resourceRouteIndex.get('Document');
      assert.deepStrictEqual(entry, { list: '/documents', view: '/documents/:id', address: 'documents' });
      assert.ok(Object.prototype.hasOwnProperty.call(server._state.content, 'documents'));
    } finally {
      await server.stop();
    }
  });

  it('sanitizes records to hashes, keys, and sizes', function () {
    const clean = FabricDocument.sanitizeRecord({
      documentId: 'x',
      merkleRootHex: 'nothex',
      title: 'leak',
      blobs: [{ blobHashHex: 'ff'.repeat(32), paymentHashHex: 'aa'.repeat(32), name: 'leak.bin' }]
    });
    assert.strictEqual(clean.merkleRootHex, null);
    assert.strictEqual(clean.title, undefined);
    assert.strictEqual(clean.blobs[0].name, undefined);
    assert.strictEqual(clean.blobs[0].blobHashHex, 'ff'.repeat(32));
  });

  it('keeps the view logic browser-safe (no Service / Peer in its require graph)', function () {
    const { execFileSync } = require('child_process');
    const out = execFileSync(process.execPath, ['-e', `
      require(${JSON.stringify(path.join(__dirname, '../functions/documentView'))});
      const loaded = Object.keys(require.cache);
      console.log(JSON.stringify(loaded.filter((f) => /types[\\\\/](service|peer|component)\\.js$|noise/.test(f))));
    `]).toString().trim();
    assert.deepStrictEqual(JSON.parse(out), []);
    const view = require('../functions/documentView');
    const record = Document.seal(Buffer.alloc(100, 1), { documentId: 'v' }).record();
    assert.strictEqual(view.renderDocumentHTML({ document: record }), new FabricDocument({ document: record })._getInnerHTML());
  });

  describe('client actions', function () {
    const realFetch = global.fetch;
    let calls;

    function respond (handler) {
      calls = [];
      global.fetch = async (url, opts) => { calls.push({ url, opts }); return handler(url, opts); };
    }

    after(function () { global.fetch = realFetch; });

    it('renders offers from the supplied state snapshot, not live view state', function () {
      const record = Document.seal(Buffer.alloc(3000, 1), { chunkBytes: 2048, documentId: 'snap' }).record();
      const component = new FabricDocument();
      const html = component._getInnerHTML({
        document: record,
        offers: [{ sellerId: 'p', sellerPubkey: 'ab'.repeat(33), blobHashHex: record.blobs[0].blobHashHex, rateSats: 4 }]
      });
      assert.ok(html.includes('4 sats'));
    });

    it('links only http(s) manifest URLs', function () {
      const record = Document.seal(Buffer.alloc(100, 1), { documentId: 'u' }).record();
      const evil = new FabricDocument({ document: record, opened: { manifest: { url: 'javascript:alert(1)' }, blobs: {} } });
      const evilHtml = evil._getInnerHTML(evil.state);
      assert.ok(!evilHtml.includes('href="javascript'));
      assert.ok(evilHtml.includes('<code>javascript:alert(1)</code>'));
      const good = new FabricDocument({ document: record, opened: { manifest: { url: 'https://example.com/a' }, blobs: {} } });
      assert.ok(good._getInnerHTML(good.state).includes('href="https://example.com/a"'));
    });

    it('loads by route id, resets opened state and offers on a different document', async function () {
      const a = Document.seal(Buffer.alloc(100, 1), { documentId: 'a' }).record();
      const b = Document.seal(Buffer.alloc(100, 2), { documentId: 'b' }).record();
      const component = new FabricDocument({ id: 'a' });
      assert.ok(component._getInnerHTML(component.state).includes('data-document-id="a"'));

      respond(async () => ({ ok: true, json: async () => ({ document: a, offers: [{ blobHashHex: a.blobs[0].blobHashHex }] }) }));
      await component._loadDocument();
      assert.strictEqual(calls[0].url, '/documents/a');
      component._setOpened({ blobs: [0], manifest: { title: 'A' } });

      respond(async () => ({ ok: true, json: async () => ({ document: b }) }));
      await component._loadDocument('b');
      assert.strictEqual(component._view.opened, null);
      assert.deepStrictEqual(component._view.offers, []);
    });

    it('discards a slower earlier load that resolves after a newer one', async function () {
      const a = Document.seal(Buffer.alloc(100, 1), { documentId: 'a' }).record();
      const b = Document.seal(Buffer.alloc(100, 2), { documentId: 'b' }).record();
      const component = new FabricDocument({ id: 'a' });
      const pending = {};
      respond((url) => new Promise((resolve) => { pending[url] = resolve; }));
      const reply = (doc) => ({ ok: true, json: async () => ({ document: doc, offers: [{ blobHashHex: doc.blobs[0].blobHashHex }] }) });

      const first = component._loadDocument('a');
      const second = component._loadDocument('b');
      pending['/documents/b'](reply(b));
      assert.strictEqual((await second).documentId, 'b');
      pending['/documents/a'](reply(a));
      assert.strictEqual(await first, null, 'stale response is dropped');
      assert.strictEqual(component._view.document.documentId, 'b');
      assert.strictEqual(component._view.offers[0].blobHashHex, b.blobs[0].blobHashHex);

      // Superseded while parsing the body: the json() await is checked too.
      let releaseJson;
      respond(() => ({ ok: true, json: () => new Promise((resolve) => { releaseJson = () => resolve({ document: a }); }) }));
      const slow = component._loadDocument('a');
      await new Promise((resolve) => setImmediate(resolve));
      respond(async () => reply(b));
      await component._loadDocument('b');
      releaseJson();
      assert.strictEqual(await slow, null);
      assert.strictEqual(component._view.document.documentId, 'b');
    });

    it('buys by Tree root when the record has no id and emits the parsed payment request', async function () {
      const { encodeFabricPaymentRequestHeaderValue } = require('../functions/fabricDocumentPayment402');
      const record = Object.assign(Document.seal(Buffer.alloc(100, 3), { documentId: 'x' }).record(), { documentId: null });
      const component = new FabricDocument({ document: record });
      const offer = { documentOffer: { blobHashHex: record.blobs[0].blobHashHex, rateSats: 2 } };
      const header = encodeFabricPaymentRequestHeaderValue(JSON.stringify(offer));
      respond(async () => ({ status: 402, headers: { get: () => header } }));
      const seen = [];
      component.on('paymentRequest', (e) => seen.push(e));
      const request = await component._buyBlob('0');
      assert.strictEqual(calls[0].url, `/documents/${record.merkleRootHex}/blobs/0`);
      assert.deepStrictEqual(request, offer);
      assert.deepStrictEqual(seen[0], { blobIndex: 0, request: offer });

      respond(async () => ({ status: 402, headers: { get: () => encodeFabricPaymentRequestHeaderValue('not json') } }));
      assert.strictEqual(await component._buyBlob(0), null);
      assert.strictEqual(seen.length, 1);
    });
  });
});
