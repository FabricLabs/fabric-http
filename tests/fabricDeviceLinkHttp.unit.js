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
  clientMayAccessDeviceLink,
  handleDeviceLinkCancel
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

describe('fabricDeviceLinkHttp cancel', function () {
  function mockRes () {
    const out = { statusCode: 0, body: null };
    return {
      out,
      setHeader () {},
      status (code) { out.statusCode = code; return this; },
      send (body) {
        out.body = typeof body === 'string' ? JSON.parse(body) : body;
        return this;
      }
    };
  }

  it('DELETE of a missing session is success (Cancel is always safe)', function () {
    const hub = { _deviceLinkSessions: new Map() };
    const res = mockRes();
    handleDeviceLinkCancel(hub, {
      params: { sessionId: 'aa'.repeat(24) },
      headers: { origin: 'https://relay.goon.vc' },
      socket: { remoteAddress: '203.0.113.9' }
    }, res);
    assert.strictEqual(res.out.statusCode, 200);
    assert.strictEqual(res.out.body.ok, true);
    assert.strictEqual(res.out.body.existed, false);
  });

  it('DELETE drops a pending session when Origin matches', function () {
    const sessionId = 'bb'.repeat(24);
    const hub = {
      _deviceLinkSessions: new Map([[sessionId, {
        status: 'pending',
        origin: 'https://relay.goon.vc',
        createdAt: Date.now()
      }]])
    };
    const res = mockRes();
    handleDeviceLinkCancel(hub, {
      params: { sessionId },
      headers: { origin: 'https://relay.goon.vc' },
      socket: { remoteAddress: '203.0.113.9' }
    }, res);
    assert.strictEqual(res.out.statusCode, 200);
    assert.strictEqual(res.out.body.cancelled, true);
    assert.strictEqual(res.out.body.existed, true);
    assert.strictEqual(hub._deviceLinkSessions.has(sessionId), false);
  });

  it('DELETE of a linked session is 409 and keeps the row', function () {
    const sessionId = 'cc'.repeat(24);
    const hub = {
      _deviceLinkSessions: new Map([[sessionId, {
        status: 'linked',
        origin: 'https://relay.goon.vc',
        createdAt: Date.now()
      }]])
    };
    const res = mockRes();
    handleDeviceLinkCancel(hub, {
      params: { sessionId },
      headers: { origin: 'https://relay.goon.vc' },
      socket: { remoteAddress: '203.0.113.9' }
    }, res);
    assert.strictEqual(res.out.statusCode, 409);
    assert.strictEqual(hub._deviceLinkSessions.has(sessionId), true);
  });

  it('DELETE with a mismatched Origin is 403', function () {
    const sessionId = 'dd'.repeat(24);
    const hub = {
      _deviceLinkSessions: new Map([[sessionId, {
        status: 'pending',
        origin: 'https://relay.goon.vc',
        createdAt: Date.now()
      }]])
    };
    const res = mockRes();
    handleDeviceLinkCancel(hub, {
      params: { sessionId },
      headers: { origin: 'https://phish.example' },
      socket: { remoteAddress: '203.0.113.9' }
    }, res);
    assert.strictEqual(res.out.statusCode, 403);
    assert.strictEqual(hub._deviceLinkSessions.has(sessionId), true);
  });
});
