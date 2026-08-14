'use strict';

const assert = require('assert');

describe('@fabric/http IdentityCrossSign re-exports', function () {
  this.timeout(10000);
  it('re-exports canonical strings from @fabric/core', function () {
    const httpXs = require('../functions/identityCrossSign');
    const coreXs = require('@fabric/core/functions/identityCrossSign');
    assert.strictEqual(httpXs.SIGN_TYPE, coreXs.SIGN_TYPE);
    assert.strictEqual(httpXs.REVOKE_TYPE, coreXs.REVOKE_TYPE);
    assert.strictEqual(typeof httpXs.buildCrossSignMessage, 'function');
  });

  it('re-exports Schnorr helpers used by site-login / device-link', function () {
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

  it('re-exports sign/verify for IdentityCrossSign bodies', function () {
    const httpXv = require('../functions/identityCrossSignVerify');
    const coreXv = require('@fabric/core/functions/identityCrossSignVerify');
    assert.strictEqual(typeof httpXv.signCrossSign, 'function');
    assert.strictEqual(httpXv.verifyCrossSignObject, coreXv.verifyCrossSignObject);
  });

  it('exposes resolveFabricSigningIdentity from site-login verify', function () {
    const site = require('../functions/fabricSiteLoginVerify');
    const schnorr = require('../functions/fabricIdentitySchnorr');
    assert.strictEqual(
      site.resolveFabricSigningIdentity,
      schnorr.resolveFabricSigningIdentity
    );
  });

  it('signs a raw HD Key with fabricKey pubkey via the core pin', function () {
    const crypto = require('crypto');
    const Key = require('@fabric/core/types/key');
    const Identity = require('@fabric/core/types/identity');
    const { signCrossSign, verifyCrossSignObject } = require('../functions/identityCrossSignVerify');
    const master = new Key();
    const ident = new Identity(master);
    const peer = new Identity(new Key());
    const obj = signCrossSign(master, {
      peerPubkey: peer.pubkey,
      nonce: crypto.randomBytes(32).toString('hex')
    });
    assert.strictEqual(obj.localPubkey.toLowerCase(), ident.fabricKey.pubkey.toLowerCase());
    assert.notStrictEqual(obj.localPubkey.toLowerCase(), String(master.pubkey).toLowerCase());
    assert.strictEqual(verifyCrossSignObject(obj).ok, true);
  });

  it('rejects unknown kind and truncated identity-id hex via the core pin', function () {
    const crypto = require('crypto');
    const Key = require('@fabric/core/types/key');
    const Identity = require('@fabric/core/types/identity');
    const { SIGN_TYPE, buildCrossSignMessage } = require('../functions/identityCrossSign');
    const { signCrossSign } = require('../functions/identityCrossSignVerify');
    const { fabricIdentityIdFromPubkeyHex } = require('../functions/fabricIdentitySchnorr');
    const ident = new Identity(new Key());
    const peer = new Identity(new Key());
    const nonce = crypto.randomBytes(32).toString('hex');
    assert.throws(
      () => signCrossSign(ident, { peerPubkey: peer.pubkey, nonce }, 'ChatMessage'),
      /unknown cross-sign type/i
    );
    assert.strictEqual(buildCrossSignMessage(nonce, 'aa', peer.pubkey), null);
    assert.throws(() => fabricIdentityIdFromPubkeyHex('02aa'), /66 hex/i);
    assert.ok(typeof fabricIdentityIdFromPubkeyHex(ident.fabricKey.pubkey) === 'string');
    assert.strictEqual(SIGN_TYPE, 'IdentityCrossSign');
  });

  it('resolves core home-env / key-material helpers on this pin', function () {
    const home = require('@fabric/core/functions/fabricHomeEnv');
    const material = require('@fabric/core/functions/fabricKeyMaterial');
    assert.strictEqual(typeof home.loadFabricHomeEnv, 'function');
    assert.strictEqual(typeof material.parseRawSeedHex, 'function');
    assert.strictEqual(typeof material.keySettingsFromEnv, 'function');
    const hex = 'aa'.repeat(32);
    assert.strictEqual(material.classifyFabricKeyMaterial(hex).kind, 'seedHex');
  });
});
