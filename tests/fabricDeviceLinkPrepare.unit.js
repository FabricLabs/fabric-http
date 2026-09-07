'use strict';

const assert = require('assert');
const Key = require('@fabric/core/types/key');
const Identity = require('@fabric/core/types/identity');
const {
  mountFabricDeviceLinkHttp,
  handleDeviceLinkCreate,
  handleDeviceLinkSign
} = require('../functions/fabricDeviceLinkHttp');
const {
  buildDeviceLinkOfferMessage,
  buildDeviceLinkMessage
} = require('../functions/fabricDeviceLinkMessages');
const {
  buildFabricIdentitySignedPayload
} = require('../functions/fabricIdentitySchnorr');

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

function mockHub () {
  const hub = { _deviceLinkSessions: new Map() };
  mountFabricDeviceLinkHttp({
    _deviceLinkSessions: hub._deviceLinkSessions,
    http: {
      _addRoute () {}
    }
  });
  return hub;
}

describe('fabricDeviceLinkHttp prepare/commit (v2)', function () {
  it('prepare returns server nonce and sessionId-bound offerMessage', function () {
    const hub = mockHub();
    const key = new Key();
    const ident = new Identity(key);
    const fabric = ident.fabricKey;
    const origin = 'https://relay.goon.vc';
    const res = mockRes();
    handleDeviceLinkCreate(hub, {
      body: {
        origin,
        label: 'phone',
        identity: { xpub: fabric.xpub, id: ident.id }
      },
      headers: { origin },
      socket: { remoteAddress: '127.0.0.1' }
    }, res);
    assert.strictEqual(res.out.statusCode, 200);
    assert.strictEqual(res.out.body.status, 'awaiting_offer');
    assert.ok(res.out.body.sessionId);
    assert.ok(res.out.body.nonce);
    assert.strictEqual(
      res.out.body.offerMessage,
      buildDeviceLinkOfferMessage(
        res.out.body.sessionId,
        res.out.body.nonce,
        ident.id,
        'phone',
        origin
      )
    );
    assert.ok(res.out.body.pollSecret);
  });

  it('protocolUrl uses rendezvous hub base, not page origin when they differ', function () {
    const hub = mockHub();
    hub.settings = { publicOrigin: 'https://hub.fabric.pub' };
    const key = new Key();
    const ident = new Identity(key);
    const fabric = ident.fabricKey;
    const pageOrigin = 'https://goon.vc';
    const res = mockRes();
    handleDeviceLinkCreate(hub, {
      body: {
        origin: pageOrigin,
        label: 'phone',
        identity: { xpub: fabric.xpub, id: ident.id }
      },
      headers: { origin: pageOrigin, host: 'hub.fabric.pub' },
      socket: { remoteAddress: '127.0.0.1' }
    }, res);
    assert.strictEqual(res.out.statusCode, 200);
    assert.match(
      res.out.body.protocolUrl,
      /hub=https%3A%2F%2Fhub\.fabric\.pub/
    );
    assert.ok(!res.out.body.protocolUrl.includes(encodeURIComponent(pageOrigin)));
  });

  it('rejects client-supplied nonce on prepare', function () {
    const hub = mockHub();
    const key = new Key();
    const ident = new Identity(key);
    const res = mockRes();
    handleDeviceLinkCreate(hub, {
      body: {
        origin: 'https://relay.goon.vc',
        label: 'phone',
        nonce: 'aa'.repeat(32),
        identity: { xpub: ident.fabricKey.xpub }
      },
      headers: { origin: 'https://relay.goon.vc' },
      socket: { remoteAddress: '127.0.0.1' }
    }, res);
    assert.strictEqual(res.out.statusCode, 400);
    assert.match(res.out.body.error, /client nonce rejected/i);
  });

  it('commit verifies offer signature and binds link message to sessionId', function () {
    const hub = mockHub();
    const initiatorKey = new Key();
    const initiator = new Identity(initiatorKey);
    const responderKey = new Key();
    const responder = new Identity(responderKey);
    const origin = 'https://relay.goon.vc';
    const sessionId = 'cc'.repeat(24);
    const nonce = 'dd'.repeat(32);
    const label = 'desk';
    const offerMessage = buildDeviceLinkOfferMessage(sessionId, nonce, initiator.id, label, origin);
    const offerSigned = buildFabricIdentitySignedPayload(initiator, offerMessage);
    hub._deviceLinkSessions.set(sessionId, {
      status: 'awaiting_offer',
      origin,
      nonce,
      pollSecret: 'ee'.repeat(32),
      label,
      offerMessage,
      createdAt: Date.now(),
      initiator: {
        id: initiator.id,
        xpub: initiator.fabricKey.xpub,
        pubkeyHex: initiator.fabricKey.pubkey.toLowerCase()
      }
    });

    const commitRes = mockRes();
    handleDeviceLinkCreate(hub, {
      body: {
        origin,
        sessionId,
        label,
        identity: offerSigned.identity,
        pubkeyHex: offerSigned.pubkeyHex,
        signature: offerSigned.signature
      },
      headers: { origin },
      socket: { remoteAddress: '127.0.0.1' }
    }, commitRes);
    assert.strictEqual(commitRes.out.statusCode, 200);
    assert.strictEqual(commitRes.out.body.status, 'pending');

    const linkMessage = buildDeviceLinkMessage(sessionId, nonce, initiator.id, responder.id, label);
    const responderSigned = buildFabricIdentitySignedPayload(responder, linkMessage);
    const signRes = mockRes();
    handleDeviceLinkSign(hub, {
      params: { sessionId },
      body: {
        role: 'responder',
        signature: responderSigned.signature,
        pubkeyHex: responderSigned.pubkeyHex,
        identity: responderSigned.identity
      },
      headers: { origin },
      socket: { remoteAddress: '127.0.0.1' }
    }, signRes);
    assert.strictEqual(signRes.out.statusCode, 200);
    assert.strictEqual(signRes.out.body.linkMessage, linkMessage);
    assert.ok(signRes.out.body.linkMessage.includes(sessionId));
  });
});
