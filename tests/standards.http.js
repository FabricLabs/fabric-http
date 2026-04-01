'use strict';

const assert = require('assert');
const fs = require('fs');
const net = require('net');
const os = require('os');
const path = require('path');

const { applyPatch, validate: validatePatch } = require('fast-json-patch');
const Ajv = require('ajv');

const { httpRequest } = require('./helpers/httpRequest');
const { assertHtml5LikeDocument } = require('./helpers/htmlCompliance');
const { jsonRpcSuccessResponse, jsonRpcErrorResponse } = require('./schemas/jsonrpc');

const HTTPServer = require('../types/server');

function ephemeralPort () {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.listen(0, '127.0.0.1', () => {
      const addr = s.address();
      const port = typeof addr === 'object' && addr ? addr.port : null;
      s.close((err) => (err ? reject(err) : resolve(port)));
    });
    s.on('error', reject);
  });
}

describe('@fabric/http standards', function () {
  this.timeout(20000);

  describe('JSON Patch (RFC 6902) via fast-json-patch', function () {
    it('applies and validates a replace patch', function () {
      const doc = { a: 1, b: { c: 2 } };
      const patch = [{ op: 'replace', path: '/a', value: 99 }];
      const err = validatePatch(patch, doc);
      assert.strictEqual(err, undefined);
      const next = applyPatch(doc, patch, false, false).newDocument;
      assert.strictEqual(next.a, 99);
      assert.strictEqual(next.b.c, 2);
    });

    it('rejects invalid patches', function () {
      const err = validatePatch([{ op: 'bogus', path: '/' }]);
      assert.ok(err, 'expected validate() to return a JsonPatchError for invalid op');
      assert.ok(/bogus|OPERATION_OP_INVALID|RFC-6902/i.test(String(err.message || err.name)));
    });

    it('supports add / remove for nested paths', function () {
      const doc = { list: [1, 2] };
      const out = applyPatch(doc, [
        { op: 'add', path: '/list/-', value: 3 },
        { op: 'remove', path: '/list/0' }
      ]).newDocument;
      assert.deepStrictEqual(out.list, [2, 3]);
    });
  });

  describe('JSON Schema (AJV) — JSON-RPC 2.0 shapes', function () {
    const ajv = new Ajv({ allErrors: true, strict: false });
    const okSuccess = ajv.compile(jsonRpcSuccessResponse);
    const okError = ajv.compile(jsonRpcErrorResponse);

    it('accepts a success envelope', function () {
      const data = { jsonrpc: '2.0', id: 1, result: { x: 1 } };
      const ok = okSuccess(data);
      if (!ok) assert.fail(ajv.errorsText(okSuccess.errors));
    });

    it('accepts an error envelope', function () {
      const data = { jsonrpc: '2.0', id: null, error: { code: -32600, message: 'bad' } };
      const ok = okError(data);
      if (!ok) assert.fail(ajv.errorsText(okError.errors));
    });
  });

  describe('HTTPServer — HTML & content negotiation', function () {
    let port;
    let server;
    let tmpDir;
    let accessLog;

    before(async function () {
      port = await ephemeralPort();
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fabric-http-standards-'));
      accessLog = path.join(tmpDir, 'access.log');
      const fixtureDir = path.join(__dirname, 'fixtures', 'standards');
      fs.copyFileSync(path.join(fixtureDir, 'minimal.html'), path.join(tmpDir, 'index.html'));
      fs.copyFileSync(path.join(fixtureDir, 'minimal.css'), path.join(tmpDir, 'minimal.css'));

      server = new HTTPServer({
        port,
        host: '127.0.0.1',
        interface: '127.0.0.1',
        hostname: '127.0.0.1',
        listen: true,
        assets: tmpDir,
        accessLog,
        jsonRpc: { enabled: true, paths: ['/rpc'], requireAuth: false },
        sitemap: {
          includeJsonRpc: true,
          urls: ['/docs', 'https://example.com/external']
        }
      });

      server._registerMethod('StandardsEcho', (x) => ({ echoed: x }));
      server._addRoute('GET', '/standards/negotiate', (req, res) => {
        server.formatResponse(req, res, { item: 'value' }, {
          title: 'Standards',
          resourceName: 'Negotiation test'
        });
      });

      await server.start();
    });

    after(async function () {
      if (server) {
        try {
          await server.stop();
        } catch (e) {}
      }
    });

    it('serves static index.html with text/html and parseable HTML5', async function () {
      const r = await httpRequest({
        port,
        path: '/index.html',
        headers: { Accept: 'text/html' }
      });
      assert.strictEqual(r.statusCode, 200);
      const ct = r.headers['content-type'] || '';
      assert.ok(ct.includes('text/html'), `expected text/html, got ${ct}`);
      assertHtml5LikeDocument(r.body);
      assert.ok(r.body.includes('Standards fixture'));
    });

    it('serves static CSS with appropriate content type', async function () {
      const r = await httpRequest({ port, path: '/minimal.css' });
      assert.strictEqual(r.statusCode, 200);
      const ct = r.headers['content-type'] || '';
      assert.ok(
        ct.includes('text/css') || ct.includes('application/octet-stream'),
        `unexpected Content-Type: ${ct}`
      );
      assert.ok(r.body.includes('font-family'));
    });

    it('formatResponse returns JSON when Accept prefers application/json', async function () {
      const r = await httpRequest({
        port,
        path: '/standards/negotiate',
        headers: { Accept: 'application/json' }
      });
      assert.strictEqual(r.statusCode, 200);
      assert.ok((r.headers['content-type'] || '').includes('application/json'));
      const j = JSON.parse(r.body);
      assert.strictEqual(j.item, 'value');
    });

    it('formatResponse returns HTML when Accept prefers text/html', async function () {
      const r = await httpRequest({
        port,
        path: '/standards/negotiate',
        headers: { Accept: 'text/html' }
      });
      assert.strictEqual(r.statusCode, 200);
      assert.ok((r.headers['content-type'] || '').includes('text/html'));
      assertHtml5LikeDocument(r.body);
      assert.ok(r.body.includes('Negotiation test'));
    });

    it('formatResponse prefers JSON when JSON q-value is higher', async function () {
      const r = await httpRequest({
        port,
        path: '/standards/negotiate',
        headers: { Accept: 'application/json;q=0.9, text/html;q=0.5' }
      });
      assert.strictEqual(r.statusCode, 200);
      assert.ok((r.headers['content-type'] || '').includes('application/json'));
    });

    it('POST /rpc returns JSON-RPC 2.0 success matching schema', async function () {
      const ajv = new Ajv({ strict: false });
      const okSuccess = ajv.compile(jsonRpcSuccessResponse);
      const body = JSON.stringify({
        jsonrpc: '2.0',
        id: 42,
        method: 'StandardsEcho',
        params: [{ hello: 'fabric' }]
      });
      const r = await httpRequest({
        port,
        method: 'POST',
        path: '/rpc',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json'
        },
        body
      });
      assert.strictEqual(r.statusCode, 200);
      const j = JSON.parse(r.body);
      if (!okSuccess(j)) assert.fail(ajv.errorsText(okSuccess.errors));
      assert.strictEqual(j.result.echoed.hello, 'fabric');
    });

    it('POST /rpc error envelope matches JSON-RPC error schema', async function () {
      const ajv = new Ajv({ strict: false });
      const okError = ajv.compile(jsonRpcErrorResponse);
      const body = JSON.stringify({
        jsonrpc: '2.0',
        id: null,
        method: 'NoSuchMethod',
        params: []
      });
      const r = await httpRequest({
        port,
        method: 'POST',
        path: '/rpc',
        headers: { 'Content-Type': 'application/json' },
        body
      });
      assert.strictEqual(r.statusCode, 500);
      const j = JSON.parse(r.body);
      if (!okError(j)) assert.fail(ajv.errorsText(okError.errors));
    });

    it('OPTIONS / returns JSON describing the server', async function () {
      const r = await httpRequest({
        port,
        method: 'OPTIONS',
        path: '/',
        headers: { Accept: 'application/json' }
      });
      assert.strictEqual(r.statusCode, 200);
      const ct = r.headers['content-type'] || '';
      assert.ok(ct.includes('json'), `expected JSON content-type, got ${ct}`);
      const j = JSON.parse(r.body);
      assert.ok(typeof j.name === 'string');
      assert.ok('description' in j);
    });

    it('serves /sitemap.xml with collected runtime URLs', async function () {
      const r = await httpRequest({
        port,
        path: '/sitemap.xml',
        headers: { Accept: 'application/xml' }
      });
      assert.strictEqual(r.statusCode, 200);
      assert.ok((r.headers['content-type'] || '').includes('application/xml'));
      assert.ok(r.body.includes('<urlset'));
      assert.ok(r.body.includes('<loc>http://127.0.0.1:'));
      assert.ok(r.body.includes('<loc>https://example.com/external</loc>'));
      assert.ok(r.body.includes('/standards/negotiate</loc>'), 'includes custom GET route');
      assert.ok(r.body.includes('/rpc</loc>'), 'includes configured JSON-RPC path when enabled');
      assert.ok(r.body.includes('/docs</loc>'), 'includes runtime-configured sitemap URLs');
    });
  });
});
