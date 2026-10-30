'use strict';

const assert = require('assert');
const Key = require('@fabric/core/types/key');
const Identity = require('@fabric/core/types/identity');
const { buildFabricIdentitySignedPayload } = require('../functions/fabricIdentitySchnorr');
const { originsMatch } = require('../functions/httpRequestTrust');

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
