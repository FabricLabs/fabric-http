'use strict';

const assert = require('assert');
const { Readable } = require('stream');
const Key = require('@fabric/core/types/key');
const {
  createSiteLoginRequest,
  createFabricSignRequest,
  signSiteLoginResponse
} = require('@fabric/core/functions/fabricSiteLogin');
const { verifyFabricSiteLogin, fabricUriFromBody, verifyFabricDesktopLoginSignedPayload } = require('../functions/fabricSiteLoginVerify');
const { handleSessionCreate, handleDesktopSign, handleSessionGet } = require('../functions/fabricSiteLoginHttp');
const { createSiteLoginStore, createSession, completeSession, getSession } = require('../functions/fabricSiteLogin');
const { createFabricLocalSigner, checkLocalSignerCaller } = require('../functions/fabricLocalSigner');
const { buildDeviceLinkMessage, buildDeviceLinkOfferMessage, DEVICE_LINK_OFFER_TAG, DEVICE_LINK_TAG } = require('../functions/fabricDeviceLinkMessages');
const { buildFabricIdentitySignedPayload } = require('../functions/fabricIdentitySchnorr');
const { verifyIdentitySchnorr, fabricIdentityIdFromPubkeyHex } = require('../functions/fabricSiteLoginVerify');

const SITE = 'https://shop.example';

function mockRes () {
  const out = { statusCode: 0, body: null };
  return {
    out,
    setHeader () {},
    writeHead (code) { out.statusCode = code; },
    end (body) { out.body = body; out.done = true; },
    status (code) { out.statusCode = code; return this; },
    send (body) { out.body = body; out.done = true; return this; },
    json (body) { out.body = JSON.stringify(body); out.done = true; return this; }
  };
}

function bodyOf (res) {
  return typeof res.out.body === 'string' ? JSON.parse(res.out.body) : res.out.body;
}

function localReq (extra = {}) {
  return Object.assign({
    method: 'POST',
    url: '/services/fabric/sign',
    socket: { remoteAddress: '127.0.0.1' },
    headers: { host: '127.0.0.1:8080', origin: 'chrome-extension://abcdefghijklmnop' }
  }, extra);
}

async function waitFor (res) {
  for (let i = 0; i < 50 && !res.out.done; i++) await new Promise((resolve) => setImmediate(resolve));
}

describe('@fabric/http fabric: site login', function () {
  it('verifies a SiteLoginResponse for the expected origin and nonce', function () {
    const request = createSiteLoginRequest({ origin: SITE });
    const key = new Key();
    const response = signSiteLoginResponse({ origin: SITE, nonce: request.nonce, signer: 'passport' }, key);
    const ok = verifyFabricSiteLogin(response.uri, { origin: SITE, nonce: request.nonce });
    assert.strictEqual(ok.ok, true, ok.error);
    assert.strictEqual(ok.pubkeyHex, key.pubkey);
    assert.strictEqual(ok.signer, 'passport');
    assert.match(verifyFabricSiteLogin(response.uri, { origin: 'https://evil.example', nonce: request.nonce }).error, /origin/);
    assert.match(verifyFabricSiteLogin(response.uri, { origin: SITE }).error, /required/);
  });

  it('reads fabric: strings from text and { fabric } bodies only', function () {
    assert.strictEqual(fabricUriFromBody(' fabric:abc '), 'fabric:abc');
    assert.strictEqual(fabricUriFromBody({ fabric: 'fabric:abc' }), 'fabric:abc');
    assert.strictEqual(fabricUriFromBody({ fabric: 'https://x' }), null);
    assert.strictEqual(fabricUriFromBody({ signature: 'aa' }), null);
  });

  it('completes a Hub /sessions login with a fabric: response and hands it to the poller', function () {
    const hub = { _desktopAuthSessions: new Map() };
    const created = mockRes();
    handleSessionCreate(hub, {
      body: { origin: 'http://127.0.0.1:8080' },
      headers: { origin: 'http://127.0.0.1:8080' },
      socket: { remoteAddress: '127.0.0.1' }
    }, created);
    const { sessionId, nonce } = bodyOf(created);
    const key = new Key();
    const response = signSiteLoginResponse({ origin: 'http://127.0.0.1:8080', nonce, signer: 'passport', xpub: key.xpub }, key);

    const wrong = signSiteLoginResponse({ origin: 'http://127.0.0.1:8080', nonce: 'f'.repeat(64), signer: 'passport' }, key);
    const refused = mockRes();
    handleDesktopSign(hub, { params: { sessionId }, body: { fabric: wrong.uri }, headers: {}, socket: { remoteAddress: '127.0.0.1' } }, refused);
    assert.strictEqual(refused.out.statusCode, 400);
    assert.match(bodyOf(refused).error, /nonce/);

    const signed = mockRes();
    handleDesktopSign(hub, { params: { sessionId }, body: { fabric: response.uri }, headers: {}, socket: { remoteAddress: '127.0.0.1' } }, signed);
    assert.strictEqual(signed.out.statusCode, 200, bodyOf(signed).error);
    assert.strictEqual(bodyOf(signed).identity.xpub, key.xpub);

    const polled = mockRes();
    handleSessionGet(hub, {
      params: { sessionId },
      headers: { accept: 'application/json' },
      socket: { remoteAddress: '127.0.0.1' }
    }, polled);
    const poll = bodyOf(polled);
    assert.strictEqual(poll.status, 'signed');
    assert.strictEqual(poll.fabric, response.uri);
    assert.strictEqual(poll.signerLabel, 'passport');
    assert.ok(poll.delegationToken);

    const pageCheck = verifyFabricDesktopLoginSignedPayload(poll, { sessionId, origin: 'http://127.0.0.1:8080' });
    assert.strictEqual(pageCheck.ok, true, pageCheck.error);
    assert.strictEqual(pageCheck.fabric.pubkeyHex, key.pubkey);
    assert.match(verifyFabricDesktopLoginSignedPayload(poll, { sessionId, origin: 'http://127.0.0.1:3041' }).error, /origin/);
    assert.match(verifyFabricDesktopLoginSignedPayload(poll, { sessionId: 'a'.repeat(48), origin: 'http://127.0.0.1:8080' }).error, /session/);
    assert.match(verifyFabricDesktopLoginSignedPayload({ ...poll, fabric: wrong.uri }, { sessionId, origin: 'http://127.0.0.1:8080' }).error, /nonce/);
    assert.match(verifyFabricDesktopLoginSignedPayload({ ...poll, identity: { id: 'someone-else' } }, { sessionId, origin: 'http://127.0.0.1:8080' }).error, /identity/);
  });

  it('completes a standalone relay session with a fabric: response', function () {
    const store = createSiteLoginStore();
    const req = { headers: { origin: 'https://relay.example' }, socket: { remoteAddress: '203.0.113.4' } };
    const created = createSession(req, { origin: 'https://relay.example' }, store);
    const { sessionId, nonce } = created.json;
    const key = new Key();
    const response = signSiteLoginResponse({ origin: 'https://relay.example', nonce, signer: 'gooncitizen' }, key);
    const done = completeSession(req, sessionId, { fabric: response.uri }, store, { issueBearer: () => 'tok' });
    assert.strictEqual(done.status, 200, done.json.error);
    assert.strictEqual(done.json.delegationToken, 'tok');
    assert.strictEqual(done.json.pubkeyHex, key.pubkey);
    const polled = getSession({ ...req, headers: { ...req.headers, 'x-fabric-poll-secret': created.json.pollSecret } }, sessionId, store);
    assert.strictEqual(polled.json.fabric, response.uri);
  });
});

describe('@fabric/http local fabric: signer', function () {
  function setup (overrides = {}) {
    const desktop = new Key();
    const device = new Key();
    const prompts = [];
    const signer = createFabricLocalSigner(Object.assign({
      signer: 'hub',
      name: 'Test Hub',
      getKey: () => desktop,
      isLinkedDevice: (author) => author === device.pubkey.slice(2),
      approve: (details) => { prompts.push(details); return true; }
    }, overrides));
    return { desktop, device, prompts, signer };
  }

  function signRequestFor (device, origin = SITE, purpose) {
    const request = createSiteLoginRequest({ origin, purpose });
    return { request, sign: createFabricSignRequest({ request: request.uri, origin }, device) };
  }

  it('answers only direct loopback callers with a loopback Host and no page Origin', function () {
    assert.strictEqual(checkLocalSignerCaller(localReq()).ok, true);
    assert.strictEqual(checkLocalSignerCaller(localReq({ headers: { host: '[::1]:3041' } })).ok, true);
    assert.strictEqual(checkLocalSignerCaller(localReq({ socket: { remoteAddress: '192.168.1.5' } })).status, 403);
    assert.strictEqual(checkLocalSignerCaller(localReq({ headers: { host: '127.0.0.1:8080', 'x-forwarded-for': '1.2.3.4' } })).status, 403);
    assert.strictEqual(checkLocalSignerCaller(localReq({ headers: { host: 'rebind.attacker.example:8080' } })).status, 421);
    assert.strictEqual(checkLocalSignerCaller(localReq({ headers: { host: '127.0.0.1:8080', origin: 'https://evil.example' } })).status, 403);
    assert.strictEqual(checkLocalSignerCaller(localReq({ headers: { host: '127.0.0.1:8080', origin: 'null' } })).status, 403);
  });

  it('names the desktop identity and whether a device is linked', async function () {
    const { desktop, device, signer } = setup();
    const res = mockRes();
    signer.identity(localReq({ method: 'GET', url: `/services/fabric/identity?pubkey=${device.pubkey}` }), res);
    await waitFor(res);
    const body = bodyOf(res);
    assert.strictEqual(body.pubkey, desktop.pubkey);
    assert.match(body.id, /^id1/);
    assert.strictEqual(body.signer, 'hub');
    assert.strictEqual(body.linked, true);
    assert.strictEqual(body.locked, false);
  });

  it('signs for a linked device after approval; the site verifies it', async function () {
    const { desktop, device, prompts, signer } = setup();
    const { request, sign } = signRequestFor(device, SITE, 'Sign in to Shop');
    const res = mockRes();
    await signer.sign(localReq({ body: sign.uri }), res);
    const body = bodyOf(res);
    assert.strictEqual(res.out.statusCode, 200, body.error);
    assert.strictEqual(prompts.length, 1);
    assert.strictEqual(prompts[0].origin, SITE);
    assert.strictEqual(prompts[0].purpose, 'Sign in to Shop');
    assert.strictEqual(prompts[0].device, device.pubkey.slice(2));
    const verified = verifyFabricSiteLogin(body.fabric, { origin: SITE, nonce: request.nonce });
    assert.strictEqual(verified.ok, true, verified.error);
    assert.strictEqual(verified.pubkeyHex, desktop.pubkey);
    assert.strictEqual(verified.signer, 'hub');
    assert.strictEqual(verified.identity.xpub, null, 'xpub stays private by default');
  });

  it('spends each request nonce once', async function () {
    const { device, signer } = setup();
    const { sign } = signRequestFor(device);
    assert.strictEqual((await signer.signFabricUri(sign.uri)).status, 200);
    const again = await signer.signFabricUri(sign.uri);
    assert.strictEqual(again.status, 409);
  });

  it('refuses unlinked devices, declined prompts, and a locked desktop', async function () {
    const stranger = new Key();
    const { device, signer, prompts } = setup();
    const unlinked = await signer.signFabricUri(signRequestFor(stranger).sign.uri);
    assert.strictEqual(unlinked.status, 403);
    assert.match(unlinked.json.error, /not linked/);
    assert.strictEqual(prompts.length, 0, 'no prompt for an unlinked device');

    const declined = setup({ approve: () => false });
    const out = await declined.signer.signFabricUri(signRequestFor(declined.device).sign.uri);
    assert.strictEqual(out.status, 403);
    assert.strictEqual(out.json.declined, true);

    const locked = setup({ getKey: () => null });
    assert.strictEqual((await locked.signer.signFabricUri(signRequestFor(locked.device).sign.uri)).status, 503);
    assert.ok(device);
  });

  it('allows one approval prompt at a time', async function () {
    let release;
    const { device, signer } = setup({ approve: () => new Promise((resolve) => { release = resolve; }) });
    const first = signer.signFabricUri(signRequestFor(device).sign.uri);
    await new Promise((resolve) => setImmediate(resolve));
    const second = await signer.signFabricUri(signRequestFor(device).sign.uri);
    assert.strictEqual(second.status, 429);
    release(true);
    assert.strictEqual((await first).status, 200);
  });

  it('reads a raw text/plain body from the request stream', async function () {
    const { device, signer } = setup();
    const { sign } = signRequestFor(device);
    const stream = Readable.from([Buffer.from(sign.uri)]);
    Object.assign(stream, localReq());
    const res = mockRes();
    await signer.sign(stream, res);
    assert.strictEqual(res.out.statusCode, 200, bodyOf(res).error);
  });

  it('attaches the xpub only where includeXpub allows', async function () {
    const { desktop, device, signer } = setup({ includeXpub: (origin) => origin === 'http://127.0.0.1:8080' });
    const { request, sign } = signRequestFor(device, 'http://127.0.0.1:8080');
    const out = await signer.signFabricUri(sign.uri);
    const verified = verifyFabricSiteLogin(out.json.fabric, { origin: 'http://127.0.0.1:8080', nonce: request.nonce });
    assert.strictEqual(verified.identity.xpub, desktop.xpub);
  });

  describe('device links', function () {
    const BASE = 'http://127.0.0.1:8080';
    const SID = 'ab'.repeat(24);
    const NONCE = 'cd'.repeat(32);
    let restore = null;

    afterEach(function () {
      if (restore) restore();
      restore = null;
    });

    function stubHub (device, status = 'pending', sessionOrigin = BASE, offerOrigin = sessionOrigin) {
      const prev = globalThis.fetch;
      const hub = { posted: null, initiatorId: fabricIdentityIdFromPubkeyHex(device.pubkey) };
      const offer = buildFabricIdentitySignedPayload(
        { privateKeyHex: device.private.toString('hex'), xpub: device.xpub },
        buildDeviceLinkOfferMessage(SID, NONCE, hub.initiatorId, 'Passport', offerOrigin),
        DEVICE_LINK_OFFER_TAG
      );
      globalThis.fetch = async (url, init = {}) => {
        const u = new URL(url);
        const origin = init.headers && init.headers.Origin;
        const reply = (code, json) => ({ ok: code < 300, status: code, json: async () => json });
        if (origin !== sessionOrigin) return reply(403, { ok: false, error: 'origin does not match this session' });
        if (u.pathname === `/device-links/${SID}` && (init.method || 'GET') === 'GET') {
          return reply(200, {
            ok: true,
            status,
            sessionId: SID,
            origin: offerOrigin,
            nonce: NONCE,
            label: 'Passport',
            initiator: { id: hub.initiatorId, xpub: device.xpub, pubkeyHex: device.pubkey, offerSignature: hub.forgeOffer ? '00'.repeat(64) : offer.signature }
          });
        }
        if (u.pathname === `/device-links/${SID}/signatures` && init.method === 'POST') {
          hub.posted = JSON.parse(init.body);
          return reply(200, { ok: true, status: 'accepted' });
        }
        return reply(404, { ok: false });
      };
      restore = () => { globalThis.fetch = prev; };
      return hub;
    }

    it('accepts a pending link as the responder after approval, bound to the session id', async function () {
      const accepted = [];
      const { desktop, device, prompts, signer } = setup({
        linkBase: () => BASE,
        onLinkAccepted: (details) => accepted.push(details)
      });
      const hub = stubHub(device);
      const out = await signer.acceptDeviceLink(SID);
      assert.strictEqual(out.status, 200, out.json.error);
      assert.strictEqual(prompts[0].kind, 'link');
      assert.strictEqual(prompts[0].device, device.pubkey.slice(2));
      const desktopId = fabricIdentityIdFromPubkeyHex(desktop.pubkey);
      const message = buildDeviceLinkMessage(SID, NONCE, hub.initiatorId, desktopId, 'Passport', BASE);
      const verified = verifyIdentitySchnorr(message, hub.posted.signature, hub.posted.pubkeyHex, hub.posted.identity, DEVICE_LINK_TAG);
      assert.strictEqual(verified.ok, true, verified.error);
      assert.strictEqual(hub.posted.role, 'responder');
      assert.deepStrictEqual(accepted, [{ peerPubkey: device.pubkey, nonce: NONCE, sessionId: SID, label: 'Passport', origin: BASE }]);
    });

    it('refuses without linkBase, when declined, when not pending, and for another origin', async function () {
      const plain = setup();
      assert.strictEqual((await plain.signer.acceptDeviceLink(SID)).status, 404);

      const declined = setup({ linkBase: () => BASE, approve: () => false });
      const hub = stubHub(declined.device);
      assert.strictEqual((await declined.signer.acceptDeviceLink(SID)).status, 403);
      assert.strictEqual(hub.posted, null);
      restore();

      const done = setup({ linkBase: () => BASE });
      stubHub(done.device, 'accepted');
      assert.strictEqual((await done.signer.acceptDeviceLink(SID)).status, 409);
      restore();

      const foreign = setup({ linkBase: () => BASE });
      stubHub(foreign.device, 'pending', 'https://evil.example');
      assert.strictEqual((await foreign.signer.acceptDeviceLink(SID)).status, 404);
      assert.strictEqual(foreign.prompts.length, 0);

      const remote = setup({ linkBase: () => 'https://hub.example' });
      assert.strictEqual((await remote.signer.acceptDeviceLink(SID)).status, 404);
    });

    it('refuses before prompting when the offer signature or its origin does not check out', async function () {
      const forged = setup({ linkBase: () => BASE });
      const hub = stubHub(forged.device);
      hub.forgeOffer = true;
      assert.strictEqual((await forged.signer.acceptDeviceLink(SID)).status, 409);
      assert.strictEqual(forged.prompts.length, 0);
      assert.strictEqual(hub.posted, null);
      restore();

      const elsewhere = setup({ linkBase: () => BASE });
      const other = stubHub(elsewhere.device, 'pending', BASE, 'https://evil.example');
      assert.strictEqual((await elsewhere.signer.acceptDeviceLink(SID)).status, 409);
      assert.strictEqual(elsewhere.prompts.length, 0);
      assert.strictEqual(other.posted, null);
    });
  });
});
