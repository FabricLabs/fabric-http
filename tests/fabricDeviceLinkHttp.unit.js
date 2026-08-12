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
    const key = offerReplayKey('aa'.repeat(32), 'id1a', 'https://hub.example');
    assert.strictEqual(offerKeyInUse(hub, key), false);
    hub._deviceLinkSessions.set('sess1', {
      nonce: 'aa'.repeat(32),
      origin: 'https://hub.example',
      initiator: { id: 'id1a' }
    });
    assert.strictEqual(offerKeyInUse(hub, key), true);
    hub._deviceLinkSessions.clear();
    markOfferConsumed(hub, key);
    assert.strictEqual(offerKeyInUse(hub, key), true);
  });
});
