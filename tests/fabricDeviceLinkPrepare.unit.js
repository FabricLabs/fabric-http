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
  DEVICE_LINK_OFFER_TAG,
  DEVICE_LINK_TAG,
  buildDeviceLinkOfferMessage,
  buildDeviceLinkMessage
} = require('../functions/fabricDeviceLinkMessages');
const { verifyDeviceLinkOffer, verifyDeviceLinkResponder } = require('../functions/fabricDeviceLinkClient');
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

describe('fabricDeviceLinkHttp prepare/commit (v3)', function () {
  it('prepare returns server nonce and sessionId-bound offerMessage', function () {
    const hub = mockHub();
    const key = new Key();
    const ident = new Identity(key);
    const fabric = ident.fabricKey;
    const origin = 'https://relay.example.com';
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
    hub.settings = { publicOrigin: 'https://hub.example.com' };
    const key = new Key();
    const ident = new Identity(key);
    const fabric = ident.fabricKey;
    const pageOrigin = 'https://app.example.com';
    const res = mockRes();
    handleDeviceLinkCreate(hub, {
      body: {
        origin: pageOrigin,
        label: 'phone',
        identity: { xpub: fabric.xpub, id: ident.id }
      },
      headers: { origin: pageOrigin, host: 'hub.example.com' },
      socket: { remoteAddress: '127.0.0.1' }
    }, res);
    assert.strictEqual(res.out.statusCode, 200);
    assert.match(
      res.out.body.protocolUrl,
      /hub=https%3A%2F%2Fhub\.example\.com/
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
        origin: 'https://relay.example.com',
        label: 'phone',
        nonce: 'aa'.repeat(32),
        identity: { xpub: ident.fabricKey.xpub }
      },
      headers: { origin: 'https://relay.example.com' },
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
    const origin = 'https://relay.example.com';
    const sessionId = 'cc'.repeat(24);
    const nonce = 'dd'.repeat(32);
    const label = 'desk';
    const offerMessage = buildDeviceLinkOfferMessage(sessionId, nonce, initiator.id, label, origin);
    const offerSigned = buildFabricIdentitySignedPayload(initiator, offerMessage, DEVICE_LINK_OFFER_TAG);
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

    const linkMessage = buildDeviceLinkMessage(sessionId, nonce, initiator.id, responder.id, label, origin);
    const responderSigned = buildFabricIdentitySignedPayload(responder, linkMessage, DEVICE_LINK_TAG);
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

  function seed (hub, opts = {}) {
    const initiator = new Identity(new Key());
    const origin = opts.origin || 'https://relay.example.com';
    const sessionId = opts.sessionId || 'ab'.repeat(24);
    const nonce = 'cd'.repeat(32);
    const label = 'desk';
    const offerMessage = buildDeviceLinkOfferMessage(sessionId, nonce, initiator.id, label, origin);
    hub._deviceLinkSessions.set(sessionId, {
      status: 'awaiting_offer',
      origin,
      nonce,
      pollSecret: 'ee'.repeat(32),
      label,
      offerMessage,
      createdAt: Date.now(),
      initiator: { id: initiator.id, xpub: initiator.fabricKey.xpub, pubkeyHex: initiator.fabricKey.pubkey.toLowerCase() }
    });
    return { initiator, origin, sessionId, nonce, label, offerMessage };
  }

  function commit (hub, s, signed) {
    const res = mockRes();
    handleDeviceLinkCreate(hub, {
      body: { origin: s.origin, sessionId: s.sessionId, label: s.label, identity: signed.identity, pubkeyHex: signed.pubkeyHex, signature: signed.signature },
      headers: { origin: s.origin },
      socket: { remoteAddress: '127.0.0.1' }
    }, res);
    return res;
  }

  it('refuses an offer signed under another tag or untagged-equivalent purpose', function () {
    const hub = mockHub();
    const s = seed(hub);
    const wrongTag = buildFabricIdentitySignedPayload(s.initiator, s.offerMessage, DEVICE_LINK_TAG);
    assert.strictEqual(commit(hub, s, wrongTag).out.statusCode, 400);
    const signTag = buildFabricIdentitySignedPayload(s.initiator, s.offerMessage, 'Fabric/Sign');
    assert.strictEqual(commit(hub, s, signTag).out.statusCode, 400);
  });

  it('refuses a responder signature over a link for another origin', function () {
    const hub = mockHub();
    const s = seed(hub);
    const offerSigned = buildFabricIdentitySignedPayload(s.initiator, s.offerMessage, DEVICE_LINK_OFFER_TAG);
    assert.strictEqual(commit(hub, s, offerSigned).out.statusCode, 200);
    const responder = new Identity(new Key());
    const wrong = buildDeviceLinkMessage(s.sessionId, s.nonce, s.initiator.id, responder.id, s.label, 'https://evil.example');
    const signed = buildFabricIdentitySignedPayload(responder, wrong, DEVICE_LINK_TAG);
    const res = mockRes();
    handleDeviceLinkSign(hub, {
      params: { sessionId: s.sessionId },
      body: { role: 'responder', signature: signed.signature, pubkeyHex: signed.pubkeyHex, identity: signed.identity },
      headers: { origin: s.origin },
      socket: { remoteAddress: '127.0.0.1' }
    }, res);
    assert.strictEqual(res.out.statusCode, 400);
  });

  it('client helpers check the offer and the responder signature from session fields', function () {
    const initiator = new Identity(new Key());
    const responder = new Identity(new Key());
    const origin = 'https://relay.example.com';
    const sessionId = '12'.repeat(24);
    const nonce = '34'.repeat(32);
    const label = 'phone';
    const offerMessage = buildDeviceLinkOfferMessage(sessionId, nonce, initiator.id, label, origin);
    const offer = buildFabricIdentitySignedPayload(initiator, offerMessage, DEVICE_LINK_OFFER_TAG);
    const st = {
      status: 'pending',
      sessionId,
      origin,
      nonce,
      label,
      offerMessage,
      initiator: { id: initiator.id, xpub: initiator.fabricKey.xpub, pubkeyHex: offer.pubkeyHex, offerSignature: offer.signature }
    };
    assert.strictEqual(verifyDeviceLinkOffer(st, origin).ok, true);
    assert.strictEqual(verifyDeviceLinkOffer(st, 'https://other.example').ok, false);
    assert.strictEqual(verifyDeviceLinkOffer({ ...st, label: 'laptop' }).ok, false);
    const other = new Identity(new Key());
    assert.strictEqual(verifyDeviceLinkOffer({ ...st, initiator: { ...st.initiator, xpub: other.fabricKey.xpub } }).ok, false);
    assert.strictEqual(verifyDeviceLinkOffer({ ...st, offerMessage: offerMessage + 'x' }).ok, false);

    const linkMessage = buildDeviceLinkMessage(sessionId, nonce, initiator.id, responder.id, label, origin);
    const link = buildFabricIdentitySignedPayload(responder, linkMessage, DEVICE_LINK_TAG);
    const accepted = {
      ...st,
      status: 'accepted',
      linkMessage,
      responder: { id: responder.id, xpub: responder.fabricKey.xpub, pubkeyHex: link.pubkeyHex, signature: link.signature }
    };
    const checked = verifyDeviceLinkResponder(accepted);
    assert.strictEqual(checked.ok, true);
    assert.strictEqual(checked.linkMessage, linkMessage);
    assert.strictEqual(verifyDeviceLinkResponder({ ...accepted, origin: 'https://other.example' }).ok, false);
  });
});
