'use strict';

const assert = require('assert');
const http = require('http');
const Key = require('@fabric/core/types/key');
const Identity = require('@fabric/core/types/identity');
const { buildFabricIdentitySignedPayload } = require('../functions/fabricIdentitySchnorr');
const { originsMatch, readRequestText, readFrame, clientAddress, isTrustedProxy } = require('../functions/httpRequestTrust');

describe('@fabric/http identity HTTP', function () {
  it('signs from HD Key and from { mnemonic } bag', function () {
    const key = new Key();
    const ident = new Identity(key);
    const message = 'identity signing test';
    const fromKey = buildFabricIdentitySignedPayload(key, message, 'Fabric/Test');
    const fromBag = buildFabricIdentitySignedPayload({ mnemonic: key.mnemonic }, message, 'Fabric/Test');
    assert.strictEqual(fromKey.pubkeyHex, ident.fabricKey.pubkey);
    assert.strictEqual(fromBag.pubkeyHex, ident.fabricKey.pubkey);
    assert.strictEqual(fromKey.identity.id, fromBag.identity.id);
    assert.throws(() => buildFabricIdentitySignedPayload(key, message), /tag/);
  });

  it('signs wallet-extension-style leaf private + fabric-path xpub', function () {
    const { verifyIdentitySchnorr } = require('../functions/fabricIdentitySchnorr');
    const master = new Key();
    const ident = new Identity(master);
    const fabric = ident.fabricKey;
    const priv = Buffer.isBuffer(fabric.private)
      ? fabric.private.toString('hex')
      : String(fabric.private);
    const message = 'leaf key test';
    const payload = buildFabricIdentitySignedPayload({
      privateKeyHex: priv,
      xpub: fabric.xpub
    }, message, 'Fabric/Test');
    assert.strictEqual(payload.pubkeyHex, fabric.pubkey);
    assert.strictEqual(payload.identity.xpub, fabric.xpub);
    assert.strictEqual(verifyIdentitySchnorr(message, payload.signature, payload.pubkeyHex, payload.identity, 'Fabric/Test').ok, true);
    assert.strictEqual(verifyIdentitySchnorr(message, payload.signature, payload.pubkeyHex, payload.identity, 'Fabric/Other').ok, false);
  });

  it('matches loopback origins across localhost/127.0.0.1', function () {
    assert.strictEqual(
      originsMatch('http://127.0.0.1:8080', 'http://localhost:8080'),
      true
    );
  });
});

describe('@fabric/http core re-exports', function () {
  this.timeout(10000);
  it('re-exports the identity Schnorr helpers', function () {
    const schnorr = require('../functions/fabricIdentitySchnorr');
    const core = require('@fabric/core/functions/fabricIdentitySchnorr');
    assert.strictEqual(
      typeof schnorr.buildFabricIdentitySignedPayload,
      'function'
    );
    assert.strictEqual(
      schnorr.buildFabricIdentitySignedPayload,
      core.buildFabricIdentitySignedPayload
    );
  });

  it('resolves core home-env / key-material helpers on this pin', function () {
    const home = require('@fabric/core/functions/fabricHomeEnv');
    const material = require('@fabric/core/functions/fabricKeyMaterial');
    assert.strictEqual(typeof home.loadFabricHomeEnv, 'function');
    assert.strictEqual(typeof material.parseRawSeedHex, 'function');
    assert.strictEqual(typeof material.keySettingsFromEnv, 'function');
    const hex = 'aa'.repeat(32);
    assert.strictEqual(material.classifyFabricKeyMaterial(hex).kind, 'seedHex');
    assert.strictEqual(material.classifyFabricKeyMaterial('xprv1not-a-real-key').kind, 'xprv');
  });

  it('resolves core identity account path + coin type on this pin', function () {
    const {
      fabricIdentityAccountPath,
      resolveFabricIdentityCoinType
    } = require('@fabric/core/constants');
    assert.strictEqual(typeof fabricIdentityAccountPath, 'function');
    assert.strictEqual(typeof resolveFabricIdentityCoinType, 'function');
    assert.strictEqual(fabricIdentityAccountPath(0, 'mainnet'), "m/7777'/7777'/0'");
    assert.strictEqual(resolveFabricIdentityCoinType('mainnet'), 7777);
  });
});

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

describe('@fabric/http httpRequestTrust bodies', function () {
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

  it('answers an oversized body with its error instead of dropping the connection', async function () {
    await serve(async (req) => readRequestText(req, 16));
    const out = await post(server, 'x'.repeat(64 * 1024));
    assert.strictEqual(out.error, 'request body too large');
  });
});

describe('@fabric/http httpRequestTrust proxies', function () {
  const req = (remoteAddress, forwarded) => ({ socket: { remoteAddress }, headers: forwarded ? { 'x-forwarded-for': forwarded } : {} });

  it('reads X-Forwarded-For only from a trusted proxy', function () {
    assert.strictEqual(clientAddress(req('::ffff:127.0.0.1', '198.51.100.1, 203.0.113.9'), true), '203.0.113.9');
    assert.strictEqual(clientAddress(req('203.0.113.50', '198.51.100.1'), true), '203.0.113.50', 'a direct client cannot pick its bucket');
    assert.strictEqual(clientAddress(req('10.0.0.2', '198.51.100.1'), ['10.0.0.2']), '198.51.100.1');
    assert.strictEqual(clientAddress(req('10.0.0.3', '198.51.100.1'), '10.0.0.2,10.0.0.4'), '10.0.0.3');
    assert.strictEqual(clientAddress(req('127.0.0.1', '198.51.100.1'), false), '127.0.0.1');
    assert.strictEqual(isTrustedProxy('::1', true), true);
    assert.strictEqual(isTrustedProxy('192.0.2.1', true), false);
  });
});
