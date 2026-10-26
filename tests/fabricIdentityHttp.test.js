'use strict';

const assert = require('assert');
const Key = require('@fabric/core/types/key');
const Identity = require('@fabric/core/types/identity');
const { buildFabricIdentitySignedPayload } = require('../functions/fabricIdentitySchnorr');
const { originsMatch } = require('../functions/httpRequestTrust');
const { parseFabricDeviceLinkUrl } = require('../functions/fabricDeviceLinkProtocol');
const { DEFAULT_FABRIC_HUB_ORIGINS } = require('../functions/fabricHubAllowlist');

const ALLOWLISTED_HUB = DEFAULT_FABRIC_HUB_ORIGINS[0];
const {
  DEVICE_LINK_OFFER_TAG,
  DEVICE_LINK_TAG,
  buildDeviceLinkOfferMessage,
  buildDeviceLinkMessage,
  parseDeviceLinkMessage
} = require('../functions/fabricDeviceLinkMessages');

describe('@fabric/http identity HTTP', function () {
  it('signs from HD Key and from { mnemonic } bag', function () {
    const key = new Key();
    const ident = new Identity(key);
    const message = 'device link test';
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

  it('parses fabric://link with allowlist', function () {
    const sid = 'ab'.repeat(24);
    const link = parseFabricDeviceLinkUrl(`fabric://link?sessionId=${sid}&hub=${encodeURIComponent(ALLOWLISTED_HUB)}`);
    assert.strictEqual(link.ok, true);
    assert.strictEqual(link.kind, 'link');
    const bad = parseFabricDeviceLinkUrl(`fabric://link?sessionId=${sid}&hub=${encodeURIComponent('https://evil.example')}`);
    assert.strictEqual(bad.ok, false);
  });

  it('builds and parses v3 device-link offers and links bound to session and origin', function () {
    const sessionId = 'ab'.repeat(24);
    const nonce = 'aa'.repeat(32);
    const a = String(new Identity(new Key()).id);
    const b = String(new Identity(new Key()).id);
    const offer = buildDeviceLinkOfferMessage(sessionId, nonce, a, 'my:phone', 'https://hub.example.com/path');
    assert.strictEqual(offer, `fabric:device-link:3:offer:${sessionId}:${nonce}:${a}:my-phone:https://hub.example.com`);
    const msg = buildDeviceLinkMessage(sessionId, nonce, a, b, 'phone', 'https://hub.example.com');
    assert.strictEqual(msg, `fabric:device-link:3:link:${sessionId}:${nonce}:${a}:${b}:phone:https://hub.example.com`);
    const parsed = parseDeviceLinkMessage(msg);
    assert.strictEqual(parsed.kind, 'link');
    assert.strictEqual(parsed.sessionId, sessionId);
    assert.strictEqual(parsed.initiatorId, a);
    assert.strictEqual(parsed.responderId, b);
    assert.strictEqual(parsed.origin, 'https://hub.example.com');
    assert.strictEqual(parseDeviceLinkMessage(offer).kind, 'offer');
  });

  it('refuses ids that are not Fabric ids, self-links, and older versions', function () {
    const sessionId = 'ab'.repeat(24);
    const nonce = 'aa'.repeat(32);
    const a = String(new Identity(new Key()).id);
    assert.throws(() => buildDeviceLinkMessage(sessionId, nonce, 'id1a', a, 'x', 'https://h.example'), /id1/);
    assert.throws(() => buildDeviceLinkMessage(sessionId, nonce, a, `${a}:evil`, 'x', 'https://h.example'), /id1/);
    assert.throws(() => buildDeviceLinkMessage(sessionId, nonce, a, a, 'x', 'https://h.example'), /different/);
    assert.throws(() => buildDeviceLinkMessage(sessionId, nonce, a, a, 'x', 'javascript:alert(1)'), /origin/);
    assert.strictEqual(parseDeviceLinkMessage(`fabric:device-link:1:${nonce}:${a}:${a}:phone`), null);
    assert.strictEqual(parseDeviceLinkMessage(`fabric:device-link:2:${sessionId}:${nonce}:${a}:${a}:phone`), null);
  });

  it('uses the core signing tags for device links', function () {
    const tags = require('@fabric/core/functions/signingTags');
    assert.strictEqual(DEVICE_LINK_OFFER_TAG, tags.DEVICE_LINK_OFFER);
    assert.strictEqual(DEVICE_LINK_TAG, tags.DEVICE_LINK);
  });

  it('matches loopback origins across localhost/127.0.0.1', function () {
    assert.strictEqual(
      originsMatch('http://127.0.0.1:8080', 'http://localhost:8080'),
      true
    );
  });
});

describe('@fabric/http IdentityCrossSign re-exports', function () {
  this.timeout(10000);
  it('re-exports canonical strings from @fabric/core', function () {
    const httpXs = require('../functions/identityCrossSign');
    const coreXs = require('@fabric/core/functions/identityCrossSign');
    assert.strictEqual(httpXs.SIGN_TYPE, coreXs.SIGN_TYPE);
    assert.strictEqual(httpXs.REVOKE_TYPE, coreXs.REVOKE_TYPE);
    assert.strictEqual(typeof httpXs.buildCrossSignMessage, 'function');
  });

  it('re-exports Schnorr helpers used by device-link', function () {
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

  it('signs a raw HD Key with fabricKey pubkey via the core pin', function () {
    const crypto = require('crypto');
    const { signCrossSign, verifyCrossSignObject } = require('../functions/identityCrossSignVerify');
    const master = new Key();
    const ident = new Identity(master);
    const peer = new Identity(new Key());
    const obj = signCrossSign(master, {
      peerPubkey: peer.pubkey,
      nonce: crypto.randomBytes(32).toString('hex'),
      sessionId: crypto.randomBytes(24).toString('hex'),
      origin: 'https://hub.example.com'
    });
    assert.strictEqual(obj.localPubkey.toLowerCase(), ident.fabricKey.pubkey.toLowerCase());
    assert.notStrictEqual(obj.localPubkey.toLowerCase(), String(master.pubkey).toLowerCase());
    assert.strictEqual(verifyCrossSignObject(obj).ok, true);
  });

  it('rejects unknown kind and truncated identity-id hex via the core pin', function () {
    const crypto = require('crypto');
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
    assert.strictEqual(material.classifyFabricKeyMaterial('xprv1not-a-real-key').kind, 'xprv');
  });

  it('resolves core identity account path + coin type on this pin', function () {
    const {
      fabricIdentityAccountPath,
      resolveFabricIdentityCoinType
    } = require('@fabric/core/constants');
    assert.strictEqual(typeof fabricIdentityAccountPath, 'function');
    assert.strictEqual(typeof resolveFabricIdentityCoinType, 'function');
    assert.strictEqual(fabricIdentityAccountPath(0, 'mainnet'), "m/44'/7777'/0'");
    assert.strictEqual(resolveFabricIdentityCoinType('mainnet'), 7777);
  });
});
