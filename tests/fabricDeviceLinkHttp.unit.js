'use strict';

const assert = require('assert');
const Key = require('@fabric/core/types/key');
const Identity = require('@fabric/core/types/identity');
const {
  identityFromXpub,
  offerReplayKey,
  offerKeyInUse,
  markOfferConsumed
} = require('../functions/fabricDeviceLinkHttp');
const {
  fabricIdentityIdFromPubkeyHex,
  buildFabricIdentitySignedPayload
} = require('../functions/fabricIdentitySchnorr');

describe('fabricDeviceLinkHttp identityFromXpub', function () {
  it('resolves id from Fabric-path xpub (not BIP44 master)', function () {
    const seed = new Key();
    const fabric = new Identity(seed).fabricKey;
    const resolved = identityFromXpub(fabric.xpub);
    assert.ok(resolved.key);
    assert.strictEqual(String(resolved.pubkeyHex).toLowerCase(), String(fabric.pubkey).toLowerCase());
    assert.strictEqual(resolved.id, fabricIdentityIdFromPubkeyHex(fabric.pubkey));
    assert.ok(/^id1/.test(resolved.id));
  });

  it('matches buildFabricIdentitySignedPayload identity material', function () {
    const seed = new Key();
    const ident = new Identity(seed);
    const payload = buildFabricIdentitySignedPayload(ident, 'fabric:device-link:test');
    const resolved = identityFromXpub(payload.identity.xpub);
    assert.strictEqual(resolved.pubkeyHex, payload.pubkeyHex.toLowerCase());
    assert.strictEqual(resolved.id, payload.identity.id);
  });

  it('throws on invalid xpub', function () {
    assert.throws(() => identityFromXpub('not-an-xpub'), Error);
  });
});

describe('fabricDeviceLinkHttp offer replay keys', function () {
  it('blocks consumed and in-flight offer keys', function () {
    const hub = { _deviceLinkSessions: new Map() };
    const nonce = 'aa'.repeat(32);
    const origin = 'https://hub.example';
    const key = `${nonce}:id1a:${origin}`;
    const differentKey = `${nonce}:id1b:${origin}`;
    assert.strictEqual(offerReplayKey(nonce, 'id1a', origin), key);
    assert.strictEqual(offerKeyInUse(hub, key), false);
    assert.strictEqual(offerKeyInUse(hub, differentKey), false);
    hub._deviceLinkSessions.set('sess1', {
      nonce,
      origin,
      initiator: { id: 'id1a' }
    });
    assert.strictEqual(offerKeyInUse(hub, key), true);
    assert.strictEqual(offerKeyInUse(hub, differentKey), false);
    hub._deviceLinkSessions.clear();
    markOfferConsumed(hub, key);
    assert.strictEqual(offerKeyInUse(hub, key), true);
    assert.strictEqual(offerKeyInUse(hub, differentKey), false);
  });

  it('canonicalizes origin equivalents in the replay key', function () {
    const nonce = 'bb'.repeat(32);
    const a = offerReplayKey(nonce, 'id1a', 'https://hub.example');
    const b = offerReplayKey(nonce, 'id1a', 'https://HUB.example:443');
    const c = offerReplayKey(nonce, 'id1a', 'https://hub.example/path');
    assert.strictEqual(a, b);
    assert.strictEqual(a, c);
  });
});
