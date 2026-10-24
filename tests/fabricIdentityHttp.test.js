'use strict';

const assert = require('assert');
const Key = require('@fabric/core/types/key');
const Identity = require('@fabric/core/types/identity');
const {
  DESKTOP_LOGIN_PREFIX,
  buildLoginMessage,
  parseDesktopLoginMessage,
  verifyFabricDesktopLoginSignedPayload,
  buildFabricIdentitySignedPayload,
  originsMatchForDesktopSession
} = require('../functions/fabricSiteLoginVerify');
const { parseFabricLoginUrl, fabricLoginRequestHeaders } = require('../functions/fabricProtocolLogin');
const {
  handleDesktopSign,
  handleSessionGet,
  handleSessionCreate
} = require('../functions/fabricSiteLoginHttp');
const { getSession } = require('../functions/fabricSiteLogin');
const { parseFabricDeviceLinkUrl } = require('../functions/fabricDeviceLinkProtocol');
const {
  buildDeviceLinkMessage,
  parseDeviceLinkMessage
} = require('../functions/fabricDeviceLinkMessages');

describe('@fabric/http identity HTTP', function () {
  it('builds and parses site-login challenges', function () {
    const msg = buildLoginMessage('ab'.repeat(24), 'https://relay.goon.vc', 'cd'.repeat(32));
    assert.ok(msg.startsWith(DESKTOP_LOGIN_PREFIX + ':'));
    const parsed = parseDesktopLoginMessage(msg);
    assert.strictEqual(parsed.sessionId, 'ab'.repeat(24));
    assert.strictEqual(parsed.origin, 'https://relay.goon.vc');
  });

  it('verifies a client-signed login payload', function () {
    const key = new Key();
    const ident = new Identity(key);
    const sessionId = 'ab'.repeat(24);
    const origin = 'https://relay.goon.vc';
    const nonce = 'cd'.repeat(32);
    const message = buildLoginMessage(sessionId, origin, nonce);
    const payload = buildFabricIdentitySignedPayload(ident, message);
    const verified = verifyFabricDesktopLoginSignedPayload({
      ...payload,
      message
    }, { sessionId, origin });
    assert.strictEqual(verified.ok, true);
    assert.strictEqual(payload.pubkeyHex, ident.fabricKey.pubkey);
    assert.strictEqual(payload.identity.xpub, ident.fabricKey.xpub);
    assert.strictEqual(payload.identity.id, String(ident.id));
  });

  it('rejects a half-populated expected session binding', function () {
    const key = new Key();
    const ident = new Identity(key);
    const sessionId = 'ab'.repeat(24);
    const origin = 'https://relay.goon.vc';
    const message = buildLoginMessage(sessionId, origin, 'cd'.repeat(32));
    const payload = buildFabricIdentitySignedPayload(ident, message);
    const onlySid = verifyFabricDesktopLoginSignedPayload({ ...payload, message }, { sessionId });
    const onlyOrigin = verifyFabricDesktopLoginSignedPayload({ ...payload, message }, { origin });
    assert.strictEqual(onlySid.ok, false);
    assert.strictEqual(onlyOrigin.ok, false);
  });

  it('signs from HD Key and from { mnemonic } bag', function () {
    const key = new Key();
    const ident = new Identity(key);
    const message = buildLoginMessage('11'.repeat(24), 'https://hub.fabric.pub', '22'.repeat(32));
    const fromKey = buildFabricIdentitySignedPayload(key, message);
    const fromBag = buildFabricIdentitySignedPayload({ mnemonic: key.mnemonic }, message);
    assert.strictEqual(fromKey.pubkeyHex, ident.fabricKey.pubkey);
    assert.strictEqual(fromBag.pubkeyHex, ident.fabricKey.pubkey);
    assert.strictEqual(fromKey.identity.id, fromBag.identity.id);
  });

  it('signs Passport-style leaf private + fabric-path xpub', function () {
    const master = new Key();
    const ident = new Identity(master);
    const fabric = ident.fabricKey;
    const priv = Buffer.isBuffer(fabric.private)
      ? fabric.private.toString('hex')
      : String(fabric.private);
    const message = buildLoginMessage('33'.repeat(24), 'https://relay.goon.vc', '44'.repeat(32));
    const payload = buildFabricIdentitySignedPayload({
      privateKeyHex: priv,
      xpub: fabric.xpub
    }, message);
    assert.strictEqual(payload.pubkeyHex, fabric.pubkey);
    assert.strictEqual(payload.identity.xpub, fabric.xpub);
    const verified = verifyFabricDesktopLoginSignedPayload({
      ...payload,
      message
    }, { sessionId: '33'.repeat(24), origin: 'https://relay.goon.vc' });
    assert.strictEqual(verified.ok, true);
  });

  it('parses fabric://login and fabric://link with allowlist', function () {
    const sid = 'ab'.repeat(24);
    const login = parseFabricLoginUrl(`fabric://login?sessionId=${sid}&hub=${encodeURIComponent('https://hub.fabric.pub')}`);
    assert.strictEqual(login.ok, true);
    const bad = parseFabricLoginUrl(`fabric://login?sessionId=${sid}&hub=${encodeURIComponent('https://evil.example')}`);
    assert.strictEqual(bad.ok, false);
    const link = parseFabricDeviceLinkUrl(`fabric://link?sessionId=${sid}&hub=${encodeURIComponent('https://relay.goon.vc')}`);
    assert.strictEqual(link.ok, true);
    assert.strictEqual(link.kind, 'link');
  });

  it('builds v2 device-link messages with sessionId binding', function () {
    const sessionId = 'ab'.repeat(24);
    const nonce = 'aa'.repeat(32);
    const msg = buildDeviceLinkMessage(sessionId, nonce, 'id1a', 'id1b', 'phone');
    assert.ok(msg.startsWith('fabric:device-link:2:'));
    const parsed = parseDeviceLinkMessage(msg);
    assert.strictEqual(parsed.version, 2);
    assert.strictEqual(parsed.sessionId, sessionId);
    assert.strictEqual(parsed.initiatorId, 'id1a');
    assert.strictEqual(parsed.responderId, 'id1b');
  });

  it('parses legacy v1 device-link messages', function () {
    const nonce = 'aa'.repeat(32);
    const msg = `fabric:device-link:1:${nonce}:id1a:id1b:phone`;
    const parsed = parseDeviceLinkMessage(msg);
    assert.strictEqual(parsed.version, 1);
    assert.strictEqual(parsed.sessionId, null);
    assert.strictEqual(parsed.nonce, nonce);
  });

  it('matches loopback origins across localhost/127.0.0.1', function () {
    assert.strictEqual(
      originsMatchForDesktopSession('http://127.0.0.1:8080', 'http://localhost:8080'),
      true
    );
  });
});

describe('@fabric/http site-login sessions', function () {
  function mockRes () {
    const out = { statusCode: 0, body: null };
    return {
      out,
      setHeader () {},
      status (code) { out.statusCode = code; return this; },
      send (body) { out.body = body; return this; }
    };
  }

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

  it('create returns pollSecret and omits it from fabric:// and pending GET', function () {
    const hub = { _desktopAuthSessions: new Map() };
    const created = mockRes();
    handleSessionCreate(hub, {
      body: { origin: 'https://hub.fabric.pub' },
      headers: { origin: 'https://hub.fabric.pub' },
      socket: { remoteAddress: '203.0.113.9' }
    }, created);
    const createBody = JSON.parse(created.out.body);
    assert.strictEqual(created.out.statusCode, 200);
    assert.match(createBody.pollSecret, /^[a-f0-9]{64}$/);
    assert.ok(!String(createBody.protocolUrl).includes(createBody.pollSecret));
    assert.ok(!String(createBody.protocolUrl).includes('pollSecret'));
    const pending = mockRes();
    handleSessionGet(hub, {
      params: { sessionId: createBody.sessionId },
      headers: { origin: 'https://hub.fabric.pub', accept: 'application/json' },
      socket: { remoteAddress: '203.0.113.9' }
    }, pending);
    const pendingBody = JSON.parse(pending.out.body);
    assert.strictEqual(pending.out.statusCode, 200);
    assert.strictEqual(pendingBody.status, 'pending');
    assert.strictEqual(pendingBody.pollSecret, undefined);
  });

  it('remote GET of a signed session without pollSecret is 403 (token stays)', function () {
    const sessionId = 'aa'.repeat(24);
    const pollSecret = 'bb'.repeat(32);
    const hub = {
      _desktopAuthSessions: new Map([[sessionId, {
        status: 'signed',
        origin: 'https://hub.fabric.pub',
        pollSecret,
        identity: { id: 'id1', xpub: 'xpub1' },
        signer: 'client',
        signature: 'cc'.repeat(64),
        pubkeyHex: '02' + 'dd'.repeat(32),
        message: 'login',
        createdAt: Date.now()
      }]])
    };
    const denied = mockRes();
    handleSessionGet(hub, {
      params: { sessionId },
      headers: { origin: 'https://hub.fabric.pub', accept: 'application/json' },
      socket: { remoteAddress: '203.0.113.9' }
    }, denied);
    assert.strictEqual(denied.out.statusCode, 403);
    assert.match(JSON.parse(denied.out.body).error, /poll secret/i);
    assert.strictEqual(hub._desktopAuthSessions.has(sessionId), true);

    const redeemed = mockRes();
    handleSessionGet(hub, {
      params: { sessionId },
      headers: {
        origin: 'https://hub.fabric.pub',
        accept: 'application/json',
        'x-fabric-poll-secret': pollSecret
      },
      socket: { remoteAddress: '203.0.113.9' }
    }, redeemed);
    const body = JSON.parse(redeemed.out.body);
    assert.strictEqual(redeemed.out.statusCode, 200);
    assert.strictEqual(body.status, 'signed');
    assert.ok(body.delegationToken);
    assert.strictEqual(hub._desktopAuthSessions.has(sessionId), false);
  });

  it('remote GET of a signed session ignores ?pollSecret=', function () {
    const sessionId = '66'.repeat(24);
    const pollSecret = '77'.repeat(32);
    const hub = {
      _desktopAuthSessions: new Map([[sessionId, {
        status: 'signed',
        origin: 'https://hub.fabric.pub',
        pollSecret,
        identity: { id: 'id1', xpub: 'xpub1' },
        signer: 'client',
        createdAt: Date.now()
      }]])
    };
    const denied = mockRes();
    handleSessionGet(hub, {
      params: { sessionId },
      url: '/sessions/' + sessionId + '?pollSecret=' + pollSecret,
      query: { pollSecret },
      headers: { origin: 'https://hub.fabric.pub', accept: 'application/json' },
      socket: { remoteAddress: '203.0.113.9' }
    }, denied);
    assert.strictEqual(denied.out.statusCode, 403);
    assert.strictEqual(hub._desktopAuthSessions.has(sessionId), true);
  });

  it('remote GET of a signed session with the wrong pollSecret is 403 (token stays)', function () {
    const sessionId = '88'.repeat(24);
    const pollSecret = '99'.repeat(32);
    const wrong = 'aa'.repeat(32);
    const hub = {
      _desktopAuthSessions: new Map([[sessionId, {
        status: 'signed',
        origin: 'https://hub.fabric.pub',
        pollSecret,
        identity: { id: 'id1', xpub: 'xpub1' },
        signer: 'client',
        createdAt: Date.now()
      }]])
    };
    const denied = mockRes();
    handleSessionGet(hub, {
      params: { sessionId },
      headers: {
        origin: 'https://hub.fabric.pub',
        accept: 'application/json',
        'x-fabric-poll-secret': wrong
      },
      socket: { remoteAddress: '203.0.113.9' }
    }, denied);
    assert.strictEqual(denied.out.statusCode, 403);
    assert.strictEqual(hub._desktopAuthSessions.has(sessionId), true);
  });

  it('loopback GET of a signed session does not need pollSecret', function () {
    const sessionId = '11'.repeat(24);
    const hub = {
      _desktopAuthSessions: new Map([[sessionId, {
        status: 'signed',
        origin: 'http://127.0.0.1:8080',
        pollSecret: '22'.repeat(32),
        identity: { id: 'id1', xpub: 'xpub1' },
        signer: 'hub',
        createdAt: Date.now()
      }]])
    };
    const res = mockRes();
    handleSessionGet(hub, {
      params: { sessionId },
      headers: { accept: 'application/json' },
      socket: { remoteAddress: '127.0.0.1' }
    }, res);
    assert.strictEqual(res.out.statusCode, 200);
    assert.strictEqual(JSON.parse(res.out.body).status, 'signed');
  });

  it('LiveRelay getSession redeem requires pollSecret off-loopback', function () {
    const sessionId = '33'.repeat(24);
    const pollSecret = '44'.repeat(32);
    const store = new Map([[sessionId, {
      status: 'signed',
      origin: 'https://relay.goon.vc',
      pollSecret,
      identity: { id: 'id1', xpub: 'xpub1' },
      delegationToken: 'tok',
      signer: 'client',
      createdAt: Date.now()
    }]]);
    const denied = getSession({
      headers: { origin: 'https://relay.goon.vc' },
      socket: { remoteAddress: '203.0.113.9' }
    }, sessionId, store);
    assert.strictEqual(denied.status, 403);
    assert.strictEqual(store.has(sessionId), true);
    const ok = getSession({
      headers: {
        origin: 'https://relay.goon.vc',
        'x-fabric-poll-secret': pollSecret
      },
      socket: { remoteAddress: '203.0.113.9' }
    }, sessionId, store);
    assert.strictEqual(ok.status, 200);
    assert.strictEqual(ok.json.delegationToken, 'tok');
    assert.strictEqual(store.has(sessionId), false);
  });

  it('fabricLoginRequestHeaders attaches pollSecret without putting it on fabric://', function () {
    const pollSecret = '55'.repeat(32);
    const sessionId = 'aa'.repeat(24);
    const hub = 'https://hub.fabric.pub';
    const headers = fabricLoginRequestHeaders(hub, { pollSecret });
    assert.strictEqual(headers['X-Fabric-Poll-Secret'], pollSecret);
    const parsed = parseFabricLoginUrl(`fabric://login?sessionId=${sessionId}&hub=${encodeURIComponent(hub)}`);
    assert.strictEqual(parsed.ok, true);
    assert.ok(!String(parsed.hubBase).includes(pollSecret));
    assert.strictEqual(parsed.sessionId, sessionId);
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
