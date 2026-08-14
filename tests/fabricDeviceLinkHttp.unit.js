'use strict';

const assert = require('assert');
const Key = require('@fabric/core/types/key');
const Identity = require('@fabric/core/types/identity');
const {
  identityFromXpub,
  offerReplayKey,
  offerKeyInUse,
  markOfferConsumed,
  isCompanionWebViewOrigin,
  isExtensionOrigin,
  clientMayAccessDeviceLink
} = require('../functions/fabricDeviceLinkHttp');
const { deviceLinkHeaders } = require('../functions/fabricDeviceLinkClient');
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

describe('fabricDeviceLinkHttp per-origin create quota', function () {
  it('FIFO-evicts the oldest session when an origin exceeds the cap', function () {
    const {
      MAX_SESSIONS_PER_ORIGIN,
      evictDeviceLinkOriginOverflow
    } = require('../functions/fabricDeviceLinkHttp');
    const origin = 'https://relay.goon.vc';
    const hub = { _deviceLinkSessions: new Map() };
    for (let i = 0; i < MAX_SESSIONS_PER_ORIGIN; i++) {
      hub._deviceLinkSessions.set('sess-' + i, { origin, createdAt: i });
    }
    hub._deviceLinkSessions.set('other', { origin: 'https://hub.fabric.pub', createdAt: 0 });
    evictDeviceLinkOriginOverflow(hub, origin);
    assert.strictEqual(hub._deviceLinkSessions.has('sess-0'), false);
    assert.strictEqual(hub._deviceLinkSessions.size, MAX_SESSIONS_PER_ORIGIN);
    assert.strictEqual(hub._deviceLinkSessions.has('other'), true);
    assert.strictEqual(hub._deviceLinkSessions.has('sess-1'), true);
  });
});

describe('fabricDeviceLinkHttp companion WebView access', function () {
  it('treats Capacitor and loopback origins as companion WebViews', function () {
    assert.strictEqual(isCompanionWebViewOrigin('https://localhost'), true);
    assert.strictEqual(isCompanionWebViewOrigin('http://127.0.0.1:3041'), true);
    assert.strictEqual(isCompanionWebViewOrigin('capacitor://localhost'), true);
    assert.strictEqual(isCompanionWebViewOrigin('https://evil.example'), false);
    assert.strictEqual(isExtensionOrigin('chrome-extension://abcdefghijklmnop'), true);
    assert.strictEqual(isExtensionOrigin('https://relay.goon.vc'), false);
  });

  it('lets an Android WebView poll an allowlisted hub session', function () {
    const req = {
      headers: { origin: 'https://localhost' },
      socket: { remoteAddress: '203.0.113.9' }
    };
    assert.strictEqual(clientMayAccessDeviceLink(req, 'https://relay.goon.vc'), true);
    assert.strictEqual(clientMayAccessDeviceLink(req, 'https://phish.example'), false);
  });

  it('lets Passport (chrome-extension) create/poll an allowlisted hub session', function () {
    const req = {
      headers: { origin: 'chrome-extension://abcdefghijklmnopqrstuvwxyz' },
      socket: { remoteAddress: '203.0.113.9' }
    };
    assert.strictEqual(clientMayAccessDeviceLink(req, 'https://relay.goon.vc'), true);
    assert.strictEqual(clientMayAccessDeviceLink(req, 'https://phish.example'), false);
  });

  it('attaches Origin/Referer in Node and omits them when window is the global', function () {
    const nodeHeaders = deviceLinkHeaders('https://hub.example');
    assert.strictEqual(nodeHeaders.Origin, 'https://hub.example');
    assert.strictEqual(nodeHeaders.Referer, 'https://hub.example/');
    const prior = globalThis.window;
    globalThis.window = globalThis;
    try {
      const browserHeaders = deviceLinkHeaders('https://hub.example');
      assert.strictEqual(browserHeaders.Origin, undefined);
      assert.strictEqual(browserHeaders.Referer, undefined);
      assert.strictEqual(browserHeaders.Accept, 'application/json');
    } finally {
      if (prior === undefined) delete globalThis.window;
      else globalThis.window = prior;
    }
  });

  it('lets Firefox Passport (moz-extension) poll an allowlisted hub', function () {
    const req = {
      headers: { origin: 'moz-extension://aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee' },
      socket: { remoteAddress: '203.0.113.9' }
    };
    assert.strictEqual(isExtensionOrigin(req.headers.origin), true);
    assert.strictEqual(clientMayAccessDeviceLink(req, 'https://hub.fabric.pub'), true);
    assert.strictEqual(clientMayAccessDeviceLink(req, 'https://phish.example'), false);
  });
});
