'use strict';

/**
 * @fileoverview Coverage locks from FabricLabs/fabric-http PR #69 review comments.
 *
 * Highs: Hub self-sign is loopback-only; GET /sessions/:delegationToken is not
 * a registry credential without matching Bearer. Signed-session redeem and
 * device-link cancel require the create-response `pollSecret` off-loopback
 * (`X-Fabric-Poll-Secret` header only; never on `fabric://` / QR / query). Medium: `wss:` / `ws:` Hub
 * addresses map to `https:` / `http:` page origins and do not fail-open for
 * `https://wss`.
 */

const assert = require('assert');
const { describe, it } = require('mocha');

const {
  handleDesktopSign,
  handleSessionGet,
  handleSessionCreate
} = require('../functions/fabricSiteLoginHttp');
const {
  expectedOriginFromHubAddress,
  isHubPageOriginMatch
} = require('../functions/fabricWebRtcInterop');
const payment402 = require('../functions/fabricDocumentPayment402');
const { SAMPLE_HUB_HTTP_SERVER_NAME, DEFAULT_SAMPLE_HUB_HTTP_PORT } = require('../constants');
const { verifyBearerToken, buildBearerToken } = require('../middlewares/auth');
const { walletPathFromArgv } = require('../functions/cliWalletArgv');
const FabricDistributedExecutionHTTP = require('../types/distributedExecutionHttp');
const Key = require('@fabric/core/types/key');
const {
  ATTESTATION_TYPE,
  KIND_PEERING,
  buildOracleAttestation,
  verifyOracleAttestation,
  stableStringify
} = require('../functions/oracleAttestation');
const App = require('../types/app');
const SPA = require('../types/spa');
const {
  isAllowedFabricHub,
  assertAllowedFabricHub,
  normalizeHubOrigin
} = require('../functions/fabricHubAllowlist');
const {
  isHttpSharedModeEnabled,
  resolveHttpListenHost,
  applySharedModeWebsocketGate
} = require('../functions/httpSharedMode');

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

  it('fabricMessageParent re-export matches core and supports parent vectors', function () {
    const Key = require('@fabric/core/types/key');
    const Message = require('@fabric/core/types/message');
    const httpParent = require('../functions/fabricMessageParent');
    const coreParent = require('@fabric/core/functions/fabricMessageParent');
    assert.strictEqual(httpParent.ZERO_PARENT, coreParent.ZERO_PARENT);
    assert.strictEqual(httpParent.frameIdOf, coreParent.frameIdOf);

    const key = new Key();
    const genesis = Message.fromVector(['P2P_CHAT_MESSAGE', 'hub-genesis']).signWithKey(key);
    const child = Message.fromVector(['P2P_CHAT_MESSAGE', 'hub-child', genesis]).signWithKey(key);
    const vec = child.toVector();
    assert.strictEqual(vec.length, 3);
    assert.strictEqual(Message.fromVector(vec).parent, genesis.id);
  });

  it('device-link protocolUrl uses rendezvous hub base, not page origin', function () {
    const {
      resolveDeviceLinkHubBase,
      deviceLinkProtocolUrl
    } = require('../functions/fabricDeviceLinkHttp');
    const hub = {
      settings: { publicOrigin: 'https://hub.fabric.pub' },
      http: { settings: { hostname: '127.0.0.1', port: 8080 } }
    };
    const req = { headers: { host: 'relay.goon.vc' }, socket: {} };
    assert.strictEqual(resolveDeviceLinkHubBase(hub, req), 'https://hub.fabric.pub');
    const url = deviceLinkProtocolUrl(hub, req, 'aa'.repeat(24), 'https://goon.vc');
    assert.match(url, /hub=https%3A%2F%2Fhub\.fabric\.pub/);
    assert.ok(!url.includes('goon.vc'));
  });

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
    const { getSession } = require('../functions/fabricSiteLogin');
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
    const { fabricLoginRequestHeaders, parseFabricLoginUrl } = require('../functions/fabricProtocolLogin');
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

  it('first-class AMP inventory frames keep the wire name when JSON type is 98', function () {
    const Message = require('@fabric/core/types/message');
    const wire = Message.fromVector(['P2P_INVENTORY_RESPONSE', JSON.stringify({
      type: 98,
      host: '203.0.113.99',
      port: 7777
    })]);
    assert.strictEqual(wire.type, 'P2P_INVENTORY_RESPONSE');
    assert.notStrictEqual(wire.type, 'P2P_PEERING_OFFER');
    const body = JSON.parse(String(wire.body));
    assert.strictEqual(body.type, 98);
  });
});

describe('constants (sample hub literals)', function () {
  it('exposes sample server name and default port', function () {
    assert.strictEqual(typeof SAMPLE_HUB_HTTP_SERVER_NAME, 'string');
    assert(SAMPLE_HUB_HTTP_SERVER_NAME.length > 0);
    assert.strictEqual(typeof DEFAULT_SAMPLE_HUB_HTTP_PORT, 'number');
    assert(DEFAULT_SAMPLE_HUB_HTTP_PORT > 0);
  });
});

describe('middlewares/auth — buildBearerToken / verifyBearerToken', function () {
  it('produces a token that verifyBearerToken accepts', function () {
    const hmacKey = 'unit-test-bearer-hmac';
    const token = buildBearerToken(hmacKey, { sub: 'u1', role: 'admin' });
    const v = verifyBearerToken(token, hmacKey);
    assert.strictEqual(v.valid, true);
    assert.deepStrictEqual(v.payload, { sub: 'u1', role: 'admin' });
  });

  it('rejects when secret differs', function () {
    const token = buildBearerToken('a', { x: 1 });
    const v = verifyBearerToken(token, 'b');
    assert.strictEqual(v.valid, false);
  });

  it('rejects array payloads (non–plain object)', function () {
    assert.throws(function () {
      buildBearerToken('a', [1, 2]);
    }, /plain object/);
  });
});

describe('walletPathFromArgv', function () {
  const fallback = '/tmp/default-wallet.json';

  it('returns fallback when argv has no --wallet', function () {
    assert.strictEqual(walletPathFromArgv(['node', 'cli'], fallback), fallback);
  });

  it('reads --wallet=VALUE before Commander parse', function () {
    assert.strictEqual(
      walletPathFromArgv(['node', 'cli', '--wallet=/tmp/custom.json'], fallback),
      '/tmp/custom.json'
    );
  });

  it('reads --wallet VALUE as a separate token', function () {
    assert.strictEqual(
      walletPathFromArgv(['node', 'cli', '--wallet', '/tmp/split.json', 'serve'], fallback),
      '/tmp/split.json'
    );
  });

  it('ignores --wallet after a -- terminator', function () {
    assert.strictEqual(
      walletPathFromArgv(['node', 'cli', '--', '--wallet=/tmp/ignored.json'], fallback),
      fallback
    );
  });

  it('does not treat --wallet --flag as a path', function () {
    assert.strictEqual(
      walletPathFromArgv(['node', 'cli', '--wallet', '--password=x'], fallback),
      fallback
    );
  });

  it('does not treat --wallet -p as a path', function () {
    assert.strictEqual(
      walletPathFromArgv(['node', 'cli', '--wallet', '-p'], fallback),
      fallback
    );
  });

  it('keeps a dash-prefixed filename via --wallet=VALUE', function () {
    assert.strictEqual(
      walletPathFromArgv(['node', 'cli', '--wallet=-secret.json'], fallback),
      '-secret.json'
    );
  });
});

describe('types/distributedExecutionHttp', function () {
  it('bind registers routes when callbacks provided', function () {
    const routes = [];
    const server = {
      _addRoute (method, path, handler) {
        routes.push({ method, path });
      }
    };
    const mod = new FabricDistributedExecutionHTTP({
      getManifest: async () => ({ version: 1 }),
      getEpochStatus: async () => ({ ok: true }),
      getSidechainState: async () => ({ clock: 0 }),
      submitSidechainStatePatch: async () => ({ ok: true }),
      getSidechainJournal: async () => ({ entries: [] }),
      getSidechainSnapshots: async () => ({ snapshots: [] })
    });
    mod.bind(server);
    assert.ok(routes.some((r) => r.path === '/services/distributed/manifest'));
    assert.ok(routes.some((r) => r.path === '/services/distributed/epoch'));
    assert.ok(routes.some((r) => r.method === 'GET' && r.path === '/services/distributed/sidechain'));
    assert.ok(routes.some((r) => r.method === 'GET' && r.path === '/services/distributed/statechain'));
    assert.ok(routes.some((r) => r.method === 'POST' && r.path === '/services/distributed/sidechain/patches'));
    assert.ok(routes.some((r) => r.method === 'POST' && r.path === '/services/distributed/statechain/patches'));
    assert.ok(routes.some((r) => r.method === 'GET' && r.path === '/services/distributed/sidechain/journal'));
    assert.ok(routes.some((r) => r.method === 'GET' && r.path === '/services/distributed/sidechain/snapshots'));
    assert.ok(routes.some((r) => r.method === 'GET' && r.path === '/services/distributed/statechain/journal'));
    assert.ok(routes.some((r) => r.method === 'GET' && r.path === '/services/distributed/statechain/snapshots'));
  });
});

describe('@fabric/http oracleAttestation', function () {
  it('stableStringify sorts object keys', function () {
    assert.strictEqual(stableStringify({ b: 1, a: 2 }), '{"a":2,"b":1}');
  });

  it('signs and verifies a peering claim', function () {
    const key = new Key();
    const claim = { kind: KIND_PEERING, version: 1, fabricPeerId: key.pubkey };
    const att = buildOracleAttestation({
      claim,
      key,
      issuer: { publicKeyHex: key.pubkey, fabricIdentityId: key.pubkey }
    });
    assert.strictEqual(att['@type'], ATTESTATION_TYPE);
    assert.strictEqual(att.kind, KIND_PEERING);
    assert.ok(att.signature);
    assert.strictEqual(verifyOracleAttestation(att), true);
  });

  it('rejects tampered claims', function () {
    const key = new Key();
    const att = buildOracleAttestation({
      claim: { kind: KIND_PEERING, version: 1, n: 1 },
      key
    });
    att.claim.n = 2;
    assert.strictEqual(verifyOracleAttestation(att), false);
  });
});

describe('@fabric/http state model contract', function () {
  this.timeout(15000);

  it('App stores canonical data under _state.content', function () {
    const app = new App({ resources: {} });
    app.state = { users: { a: 1 } };
    assert.ok(app._state && app._state.content);
    assert.deepStrictEqual(app._state.content, { users: { a: 1 } });
  });

  it('App public state reads are snapshots', function () {
    const app = new App({ resources: {} });
    app.state = { users: { a: 1 } };
    const snapshot = app.state;
    snapshot.users.a = 2;
    assert.strictEqual(app._state.content.users.a, 1);
  });

  it('SPA stores canonical data under _state.content', function () {
    const spa = new SPA({ resources: {} });
    spa.state = { title: 'X', users: {} };
    assert.deepStrictEqual(spa._state.content, { title: 'X', users: {} });
  });

  it('SPA public state reads are snapshots', function () {
    const spa = new SPA({ resources: {} });
    spa.state = { title: 'X', users: { a: 1 } };
    const snapshot = spa.state;
    snapshot.users.a = 2;
    assert.strictEqual(spa._state.content.users.a, 1);
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

describe('@fabric/http fabricHubAllowlist', function () {
  it('allows default HTTPS network hubs and loopback', function () {
    assert.strictEqual(isAllowedFabricHub('https://relay.goon.vc'), true);
    assert.strictEqual(isAllowedFabricHub('https://hub.fabric.pub/sessions'), true);
    assert.strictEqual(isAllowedFabricHub('http://127.0.0.1:3041'), true);
    assert.strictEqual(isAllowedFabricHub('http://localhost:8080'), true);
  });

  it('rejects cleartext production hubs unless explicitly allowlisted', function () {
    assert.strictEqual(isAllowedFabricHub('http://hub.fabric.pub'), false);
    assert.strictEqual(isAllowedFabricHub('http://relay.goon.vc'), false);
    assert.strictEqual(
      isAllowedFabricHub('http://hub.fabric.pub', {
        env: { FABRIC_HUB_ALLOWLIST: 'http://hub.fabric.pub' }
      }),
      true
    );
  });

  it('rejects unknown hubs unless allowlisted via env', function () {
    assert.strictEqual(isAllowedFabricHub('https://evil.example'), false);
    assert.strictEqual(
      isAllowedFabricHub('https://evil.example', {
        env: { FABRIC_HUB_ALLOWLIST: 'https://evil.example' }
      }),
      true
    );
    const prev = process.env.FABRIC_HUB_ALLOWLIST;
    process.env.FABRIC_HUB_ALLOWLIST = 'https://evil.example';
    try {
      assert.strictEqual(
        isAllowedFabricHub('https://evil.example', { env: {} }),
        false
      );
    } finally {
      if (prev == null) delete process.env.FABRIC_HUB_ALLOWLIST;
      else process.env.FABRIC_HUB_ALLOWLIST = prev;
    }
  });

  it('assertAllowedFabricHub normalizes origin', function () {
    const ok = assertAllowedFabricHub('https://relay.goon.vc/path');
    assert.strictEqual(ok.ok, true);
    assert.strictEqual(ok.hubBase, 'https://relay.goon.vc');
    const bad = assertAllowedFabricHub('https://phishing.test');
    assert.strictEqual(bad.ok, false);
    assert.match(bad.error, /not allowed/);
  });

  it('normalizeHubOrigin rejects non-http(s)', function () {
    assert.strictEqual(normalizeHubOrigin('ftp://x'), null);
  });
});

describe('@fabric/http httpSharedMode', function () {
  it('treats common truthy persisted shapes as shared', function () {
    assert.strictEqual(isHttpSharedModeEnabled(true), true);
    assert.strictEqual(isHttpSharedModeEnabled(1), true);
    assert.strictEqual(isHttpSharedModeEnabled('true'), true);
    assert.strictEqual(isHttpSharedModeEnabled('1'), true);
    assert.strictEqual(isHttpSharedModeEnabled(' YES '), true);
  });

  it('treats falsey and unknown as not shared', function () {
    assert.strictEqual(isHttpSharedModeEnabled(false), false);
    assert.strictEqual(isHttpSharedModeEnabled(0), false);
    assert.strictEqual(isHttpSharedModeEnabled('false'), false);
    assert.strictEqual(isHttpSharedModeEnabled(undefined), false);
    assert.strictEqual(isHttpSharedModeEnabled(null), false);
  });

  it('resolveHttpListenHost defaults and overrides', function () {
    assert.strictEqual(resolveHttpListenHost({ mode: 'relay', env: {} }), '127.0.0.1');
    assert.strictEqual(resolveHttpListenHost({ mode: 'relay', httpSharedMode: true, env: {} }), '0.0.0.0');
    assert.strictEqual(resolveHttpListenHost({ mode: 'server', env: {} }), '0.0.0.0');
    assert.strictEqual(resolveHttpListenHost({
      mode: 'relay',
      httpSharedMode: false,
      env: { FABRIC_HUB_INTERFACE: '192.168.1.10' }
    }), '192.168.1.10');
    assert.strictEqual(resolveHttpListenHost({
      mode: 'relay',
      env: { FABRIC_HUB_INTERFACE: '65.21.231.149', FABRIC_HTTP_INTERFACE: '192.168.1.10' }
    }), '65.21.231.149');
    assert.strictEqual(resolveHttpListenHost({
      mode: 'server',
      host: '127.0.0.1',
      env: {}
    }), '127.0.0.1');
    assert.strictEqual(resolveHttpListenHost({
      mode: 'relay',
      host: '127.0.0.1',
      env: { FABRIC_HUB_INTERFACE: '0.0.0.0' }
    }), '127.0.0.1');
  });

  it('applySharedModeWebsocketGate requires token when shared + env token', function () {
    const gated = applySharedModeWebsocketGate({}, {
      bindAll: true,
      env: { FABRIC_WS_CLIENT_TOKEN: 'ws-token-fixture' }
    });
    assert.strictEqual(gated.websocket.requireClientToken, true);
    assert.strictEqual(gated.websocket.clientToken, 'ws-token-fixture');

    const untouched = applySharedModeWebsocketGate({ websocket: { requireClientToken: false } }, {
      bindAll: true,
      env: { FABRIC_WS_CLIENT_TOKEN: 'ws-token-fixture' }
    });
    assert.strictEqual(untouched.websocket.requireClientToken, false);

    const loopback = applySharedModeWebsocketGate({}, {
      bindAll: false,
      env: { FABRIC_WS_CLIENT_TOKEN: 'ws-token-fixture' }
    });
    assert.ok(!loopback.websocket);
  });

  it('applySharedModeWebsocketGate fail-closes shared bind without env token', function () {
    const gated = applySharedModeWebsocketGate({}, { bindAll: true, env: {} });
    assert.strictEqual(gated.websocket.requireClientToken, true);
    assert.ok(!gated.websocket.clientToken);
  });
});
