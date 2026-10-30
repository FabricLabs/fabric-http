'use strict';

const assert = require('assert');
const http = require('http');
const { readRequestText, readFrame } = require('../functions/delegationHttpBody');

function post (server, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      host: '127.0.0.1',
      port: server.address().port,
      method: 'POST',
      path: '/',
      headers: Object.assign({ 'content-type': 'text/plain' }, headers)
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))));
    });
    req.on('error', reject);
    req.end(body);
  });
}

describe('delegationHttpBody', function () {
  let server;

  afterEach(function (done) {
    if (!server) return done();
    server.close(() => done());
    server = null;
  });

  function serve (handler) {
    server = http.createServer((req, res) => {
      handler(req).then((out) => res.end(JSON.stringify(out)), (err) => res.end(JSON.stringify({ error: err.message })));
    });
    return new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  }

  async function afterParse (req) {
    while (!req.complete) await new Promise((resolve) => setTimeout(resolve, 5));
  }

  it('reads a body that arrived before anyone listened for it', async function () {
    await serve(async (req) => {
      await afterParse(req);
      return { complete: req.complete, text: await readRequestText(req, 1024) };
    });
    const out = await post(server, 'fabric:AAAA');
    assert.strictEqual(out.complete, true);
    assert.strictEqual(out.text, 'fabric:AAAA');
  });

  it('reads a frame after an async step in front of the route', async function () {
    await serve(async (req) => {
      await afterParse(req);
      return readFrame(req);
    });
    const out = await post(server, JSON.stringify({ frame: 'fabric:AAAA' }), { 'content-type': 'application/json' });
    assert.strictEqual(out.frame, 'fabric:AAAA');
  });

  it('returns nothing once the body has been read', async function () {
    await serve(async (req) => {
      const first = await readRequestText(req, 1024);
      return { first, second: await readRequestText(req, 1024) };
    });
    const out = await post(server, 'fabric:AAAA');
    assert.strictEqual(out.first, 'fabric:AAAA');
    assert.strictEqual(out.second, '');
  });
});
