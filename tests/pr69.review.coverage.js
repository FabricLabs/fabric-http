'use strict';

/**
 * @fileoverview Coverage locks from FabricLabs/fabric-http PR #69 review comments.
 *
 * Highs: Hub self-sign is loopback-only; GET /sessions/:delegationToken is not
 * a registry credential without matching Bearer. Medium: `wss:` / `ws:` Hub
 * addresses map to `https:` / `http:` page origins and do not fail-open for
 * `https://wss`. Possession-proof redeem (sessionId as poll capability) remains
 * tracked in docs/OUTSTANDING.md.
 */

const assert = require('assert');
const { describe, it } = require('mocha');

const {
  handleDesktopSign,
  handleSessionGet
} = require('../functions/fabricSiteLoginHttp');
const {
  expectedOriginFromHubAddress,
  isHubPageOriginMatch
} = require('../functions/fabricWebRtcInterop');
const payment402 = require('../functions/fabricDocumentPayment402');

describe('@fabric/http PR #69 review coverage', function () {
  function mockRes () {
    const out = { statusCode: 0, body: null };
    return {
      out,
      setHeader () {},
      status (code) { out.statusCode = code; return this; },
      send (body) { out.body = body; return this; }
    };
  }

  it('maps wss/ws Hub addresses to https/http page origins (no https://wss fail-open)', function () {
    assert.strictEqual(expectedOriginFromHubAddress('wss://hub.fabric.pub'), 'https://hub.fabric.pub');
    assert.strictEqual(expectedOriginFromHubAddress('ws://127.0.0.1:8080'), 'http://127.0.0.1:8080');
    assert.strictEqual(isHubPageOriginMatch('wss://hub.fabric.pub', 'https://hub.fabric.pub'), true);
    assert.strictEqual(isHubPageOriginMatch('wss://hub.fabric.pub', 'https://wss'), false);
    assert.strictEqual(isHubPageOriginMatch('wss://hub.fabric.pub', 'https://ws'), false);
    assert.strictEqual(isHubPageOriginMatch('ws://127.0.0.1:8080', 'http://127.0.0.1:8080'), true);
  });

  it('refuses Hub self-sign from a remote socket even when allowHubSelfSign is on', function () {
    const sessionId = 'cc'.repeat(24);
    const hub = {
      allowHubSelfSign: true,
      _desktopAuthSessions: new Map([[sessionId, {
        status: 'pending',
        origin: 'https://hub.fabric.pub',
        message: 'login',
        nonce: 'nn',
        createdAt: Date.now()
      }]]),
      _rootKey: { private: true, signSchnorr () { return Buffer.alloc(64); }, pubkey: 'aa'.repeat(33), xpub: 'xpub' }
    };
    const res = mockRes();
    handleDesktopSign(hub, {
      params: { sessionId },
      body: {},
      socket: { remoteAddress: '203.0.113.9' },
      headers: { origin: 'https://hub.fabric.pub' }
    }, res);
    assert.strictEqual(res.out.statusCode, 403);
    const body = typeof res.out.body === 'string' ? JSON.parse(res.out.body) : res.out.body;
    assert.match(String(body && body.error), /loopback/i);
  });

  it('refuses Hub self-sign when allowHubSelfSign is off (client signature required)', function () {
    const sessionId = 'dd'.repeat(24);
    const hub = {
      allowHubSelfSign: false,
      _desktopAuthSessions: new Map([[sessionId, {
        status: 'pending',
        origin: 'http://127.0.0.1:8080',
        message: 'login',
        nonce: 'nn',
        createdAt: Date.now()
      }]]),
      _rootKey: { private: true }
    };
    const res = mockRes();
    handleDesktopSign(hub, {
      params: { sessionId },
      body: {},
      socket: { remoteAddress: '127.0.0.1' },
      headers: {}
    }, res);
    assert.strictEqual(res.out.statusCode, 400);
  });

  it('GET /sessions/:delegationToken without Bearer is 404', function () {
    const token = 'ee'.repeat(24);
    const hub = {
      _desktopAuthSessions: new Map(),
      _delegationRegistry: new Map([[token, {
        origin: 'https://hub.fabric.pub',
        linkedAt: Date.now(),
        identityId: 'id1',
        sessionId: 'ff'.repeat(24)
      }]]),
      getDelegationSessionById (id) {
        const row = this._delegationRegistry.get(id);
        if (!row) return null;
        return { ok: true, kind: 'delegation', id, origin: row.origin, identityId: row.identityId };
      }
    };
    const res = mockRes();
    handleSessionGet(hub, {
      params: { sessionId: token },
      headers: { accept: 'application/json' },
      socket: { remoteAddress: '203.0.113.9' }
    }, res);
    assert.strictEqual(res.out.statusCode, 404);
  });

  it('402 document-offer header builder omits costBasisSats', function () {
    const raw = payment402.buildFabricDocumentPaymentRequestHeader({
      requestPath: '/services/test',
      documentOffer: {
        documentId: 'ab'.repeat(32),
        purchasePriceSats: 110,
        costBasisSats: 100
      }
    });
    const json = typeof raw === 'string' ? raw : JSON.stringify(raw);
    assert.ok(!json.includes('costBasisSats'));
    const parsed = JSON.parse(json);
    assert.strictEqual(parsed.documentOffer.purchasePriceSats, 110);
    assert.strictEqual(parsed.documentOffer.costBasisSats, undefined);
  });
});
