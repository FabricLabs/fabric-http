'use strict';

const assert = require('assert');
const { Readable } = require('stream');
const Key = require('@fabric/core/types/key');
const { FIXTURE_SEED } = require('@fabric/core/constants');
const { importSeed, deriveAccount } = require('@fabric/core/functions/accountKeys');
const {
  createChallenge,
  createSignRequest,
  verifyAssertion,
  pairingCode
} = require('@fabric/core/functions/passport');
const { fabricUriFromBody } = require('../functions/httpRequestTrust');
const { createFabricLocalSigner, checkLocalSignerCaller, isPassportOrigin } = require('../functions/fabricLocalSigner');
const { buildDeviceLinkMessage, buildDeviceLinkOfferMessage, DEVICE_LINK_OFFER_TAG, DEVICE_LINK_TAG } = require('../functions/fabricDeviceLinkMessages');
const { buildFabricIdentitySignedPayload, verifyIdentitySchnorr, fabricIdentityIdFromPubkeyHex } = require('../functions/fabricIdentitySchnorr');

const SITE = 'https://shop.example';
const CHROME_ID = 'abcdefghijklmnopabcdefghijklmnop';
const PASSPORT_ORIGIN = `chrome-extension://${CHROME_ID}`;
const MASTER = importSeed(FIXTURE_SEED);

function mockRes () {
  const out = { statusCode: 0, body: null };
  return {
    out,
    setHeader () {},
    end (body) { out.body = body; out.done = true; },
    set statusCode (code) { out.statusCode = code; },
    get statusCode () { return out.statusCode; }
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
    headers: { host: '127.0.0.1:8080', origin: PASSPORT_ORIGIN }
  }, extra);
}

function setup (overrides = {}) {
  const device = new Key();
  const prompts = [];
  const signer = createFabricLocalSigner(Object.assign({
    signer: 'hub',
    name: 'Test Hub',
    network: 'regtest',
    extensionIds: [CHROME_ID],
    getAccount: ({ network, account }) => deriveAccount(MASTER, { account: account || 0, network }),
    linkedDevice: (author) => (author === device.pubkey.slice(2) ? device.pubkey : null),
    approve: (details) => { prompts.push(details); return true; }
  }, overrides));
  return { device, prompts, signer };
}

function signRequestFor (device, params = {}) {
  const challenge = createChallenge({
    origin: params.origin || SITE,
    network: params.network || 'regtest',
    purpose: params.purpose,
    request: params.request
  });
  const sign = createSignRequest({
    challenge: challenge.uri,
    origin: params.origin || SITE,
    account: params.account,
    disclose: params.disclose,
    now: params.now
  }, device);
  return { challenge, sign };
}

function expectedFor (challenge, extra = {}) {
  return Object.assign({
    origin: SITE,
    nonce: challenge.nonce,
    challengeHash: challenge.hash,
    network: challenge.network,
    allow: challenge.request,
    challengeExpiresAt: challenge.expiresAt
  }, extra);
}

describe('@fabric/http local Passport signer', function () {
  it('reads fabric: strings from text and { fabric } bodies only', function () {
    assert.strictEqual(fabricUriFromBody(' fabric:abc '), 'fabric:abc');
    assert.strictEqual(fabricUriFromBody({ fabric: 'fabric:abc' }), 'fabric:abc');
    assert.strictEqual(fabricUriFromBody({ fabric: 'https://x' }), null);
    assert.strictEqual(fabricUriFromBody({ signature: 'aa' }), null);
  });

  it('answers only Passport on a direct loopback socket with a loopback Host', function () {
    const options = { extensionIds: [CHROME_ID] };
    assert.strictEqual(checkLocalSignerCaller(localReq(), options).ok, true);
    assert.strictEqual(checkLocalSignerCaller(localReq({ headers: { host: '[::1]:3041', origin: PASSPORT_ORIGIN } }), options).ok, true);
    assert.strictEqual(checkLocalSignerCaller(localReq({ headers: { host: 'localhost', origin: 'moz-extension://0d0c7a1e-4d1f-4c2b-9a8e-1f2e3d4c5b6a' } }), options).ok, true);
    assert.strictEqual(checkLocalSignerCaller(localReq({ socket: { remoteAddress: '192.168.1.5' } }), options).status, 403);
    assert.strictEqual(checkLocalSignerCaller(localReq({ headers: { host: '127.0.0.1:8080', origin: PASSPORT_ORIGIN, 'x-forwarded-for': '1.2.3.4' } }), options).status, 403);
    assert.strictEqual(checkLocalSignerCaller(localReq({ headers: { host: 'rebind.attacker.example:8080', origin: PASSPORT_ORIGIN } }), options).status, 421);
    assert.strictEqual(checkLocalSignerCaller(localReq({ headers: { host: '127.0.0.1:8080', origin: 'https://evil.example' } }), options).status, 403);
    assert.strictEqual(checkLocalSignerCaller(localReq({ headers: { host: '127.0.0.1:8080', origin: 'null' } }), options).status, 403);
    assert.strictEqual(checkLocalSignerCaller(localReq({ headers: { host: '127.0.0.1:8080', origin: `chrome-extension://${'b'.repeat(32)}` } }), options).status, 403, 'unpinned Chrome extension');
    assert.strictEqual(checkLocalSignerCaller(localReq({ headers: { host: '127.0.0.1:8080' } }), options).status, 403, 'no Origin');
    assert.strictEqual(isPassportOrigin('safari-web-extension://x', [CHROME_ID]), false);
  });

  it('names the desktop identity, and tells only Passport whether a device is linked', async function () {
    const { device, signer } = setup();
    const own = deriveAccount(MASTER, { account: 0, network: 'regtest' });
    const res = mockRes();
    await signer.identity(localReq({ method: 'GET', url: `/services/fabric/identity?pubkey=${device.pubkey}` }), res);
    const body = bodyOf(res);
    assert.strictEqual(body.pubkey, own.identity.pubkey);
    assert.strictEqual(body.id, own.identity.id);
    assert.strictEqual(body.network, 'regtest');
    assert.strictEqual(body.linked, true);
    assert.strictEqual(body.locked, false);

    const native = mockRes();
    await signer.identity(localReq({ method: 'GET', url: `/services/fabric/identity?pubkey=${device.pubkey}`, headers: { host: '127.0.0.1:8080' } }), native);
    assert.strictEqual(native.out.statusCode, 200);
    assert.strictEqual(bodyOf(native).linked, undefined);

    const page = mockRes();
    await signer.identity(localReq({ method: 'GET', headers: { host: '127.0.0.1:8080', origin: 'https://evil.example' } }), page);
    assert.strictEqual(page.out.statusCode, 403);
  });

  it('signs for a linked device after approval with the account for the challenge network', async function () {
    const { device, prompts, signer } = setup();
    const { challenge, sign } = signRequestFor(device, { purpose: 'Sign in to Shop', network: 'testnet' });
    const res = mockRes();
    await signer.sign(localReq({ body: sign.uri }), res);
    const body = bodyOf(res);
    assert.strictEqual(res.out.statusCode, 200, body.error);
    assert.strictEqual(prompts.length, 1);
    assert.deepStrictEqual(prompts[0].shares, ['identity']);
    assert.strictEqual(prompts[0].origin, SITE);
    assert.strictEqual(prompts[0].purpose, 'Sign in to Shop');
    assert.strictEqual(prompts[0].device, device.pubkey);
    assert.strictEqual(prompts[0].network, 'testnet');
    const verified = verifyAssertion(body.fabric, expectedFor(challenge));
    assert.strictEqual(verified.ok, true, verified.error);
    assert.strictEqual(verified.signer, 'hub');
    assert.strictEqual(verified.device, device.pubkey);
    assert.strictEqual(verified.network, 'testnet');
    assert.strictEqual(verified.identity.pubkey, deriveAccount(MASTER, { account: 0, network: 'testnet' }).identity.pubkey);
    assert.strictEqual(verified.wallet, null);
    assert.strictEqual(verified.cosigner, null);
  });

  it('shares wallet and cosigner keys only when asked and listed, and says so in the prompt', async function () {
    const { device, prompts, signer } = setup();
    const { challenge, sign } = signRequestFor(device, { request: ['wallet', 'cosigner'], disclose: ['wallet', 'cosigner'], account: 2 });
    const out = await signer.signFabricUri(sign.uri);
    assert.strictEqual(out.status, 200, out.json.error);
    assert.deepStrictEqual(prompts[0].shares, ['identity', 'wallet', 'cosigner']);
    assert.strictEqual(prompts[0].account, 2);
    const verified = verifyAssertion(out.json.fabric, expectedFor(challenge));
    assert.strictEqual(verified.ok, true, verified.error);
    const account = deriveAccount(MASTER, { account: 2, network: 'regtest' });
    assert.strictEqual(verified.wallet.segwit.xpub, account.wallet.segwit.xpub);
    assert.strictEqual(verified.cosigner.pubkey, account.cosigner.pubkey);

    const askedOnly = signRequestFor(device, { request: ['wallet'] });
    const plain = await signer.signFabricUri(askedOnly.sign.uri);
    assert.strictEqual(plain.status, 200);
    assert.deepStrictEqual(prompts[1].shares, ['identity'], 'requested but not chosen in Passport');
    assert.strictEqual(verifyAssertion(plain.json.fabric, expectedFor(askedOnly.challenge)).wallet, null);
  });

  it('spends each request nonce once, and keeps it past expiry', async function () {
    let clock = Date.now();
    const { device, signer } = setup({ now: () => clock });
    const { sign } = signRequestFor(device, { now: clock });
    assert.strictEqual((await signer.signFabricUri(sign.uri)).status, 200);
    assert.strictEqual((await signer.signFabricUri(sign.uri)).status, 409);
    clock = sign.expiresAt + 1000;
    assert.notStrictEqual((await signer.signFabricUri(sign.uri)).status, 200);
  });

  it('tells a v1 Passport to update before reading its request', async function () {
    const { device, prompts, signer } = setup();
    const { sign } = signRequestFor(device);
    const frame = Buffer.from(sign.uri.slice('fabric:'.length), 'base64url');
    frame.writeUInt32BE(0x4232, 72);
    frame.fill(0, 40, 72);
    frame.fill(0, 144, 208);
    const out = await signer.signFabricUri(`fabric:${frame.toString('base64url')}`);
    assert.strictEqual(out.status, 426);
    assert.strictEqual(out.json.error, 'passport_outdated');
    assert.strictEqual(prompts.length, 0);
  });

  it('refuses requests issued before it started', async function () {
    const device = new Key();
    const early = signRequestFor(device, { now: Date.now() - 5000 });
    const { signer } = setup({ linkedDevice: () => device.pubkey });
    const out = await signer.signFabricUri(early.sign.uri);
    assert.strictEqual(out.status, 409);
    assert.match(out.json.error, /predates/);
  });

  it('refuses unlinked devices, declined prompts, and a locked desktop', async function () {
    const stranger = new Key();
    const { signer, prompts } = setup();
    const unlinked = await signer.signFabricUri(signRequestFor(stranger).sign.uri);
    assert.strictEqual(unlinked.status, 403);
    assert.match(unlinked.json.error, /not linked/);
    assert.strictEqual(prompts.length, 0, 'no prompt for an unlinked device');

    const wrongParity = setup({ linkedDevice: () => '02' + 'ab'.repeat(32) });
    assert.strictEqual((await wrongParity.signer.signFabricUri(signRequestFor(wrongParity.device).sign.uri)).status, 403);

    const declined = setup({ approve: () => false });
    const out = await declined.signer.signFabricUri(signRequestFor(declined.device).sign.uri);
    assert.strictEqual(out.status, 403);
    assert.strictEqual(out.json.declined, true);

    const locked = setup({ getAccount: () => null });
    assert.strictEqual((await locked.signer.signFabricUri(signRequestFor(locked.device).sign.uri)).status, 503);
  });

  it('allows one sign prompt at a time', async function () {
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

    it('accepts a pending link after the user matches the pairing code', async function () {
      const accepted = [];
      const { device, prompts, signer } = setup({
        linkBase: () => BASE,
        onLinkAccepted: (details) => accepted.push(details)
      });
      const hub = stubHub(device);
      const out = await signer.acceptDeviceLink(SID);
      assert.strictEqual(out.status, 200, out.json.error);
      const desktop = deriveAccount(MASTER, { account: 0, network: 'regtest' }).identity;
      assert.strictEqual(prompts[0].kind, 'link');
      assert.strictEqual(prompts[0].device, device.pubkey);
      assert.strictEqual(prompts[0].code, pairingCode(device.pubkey, desktop.pubkey));
      assert.match(prompts[0].code, /^[0-9]{6}$/);
      assert.strictEqual(out.json.code, prompts[0].code);
      const message = buildDeviceLinkMessage(SID, NONCE, hub.initiatorId, desktop.id, 'Passport', BASE);
      const verified = verifyIdentitySchnorr(message, hub.posted.signature, hub.posted.pubkeyHex, hub.posted.identity, DEVICE_LINK_TAG);
      assert.strictEqual(verified.ok, true, verified.error);
      assert.strictEqual(hub.posted.role, 'responder');
      assert.deepStrictEqual(accepted, [{ peerPubkey: device.pubkey, nonce: NONCE, sessionId: SID, label: 'Passport', origin: BASE }]);
    });

    it('prompts for a link at most once every 30 seconds, apart from sign prompts', async function () {
      let clock = Date.now();
      let releaseLink;
      const { device, signer } = setup({
        linkBase: () => BASE,
        now: () => clock,
        approve: (prompt) => (prompt.kind === 'link' ? new Promise((resolve) => { releaseLink = resolve; }) : true)
      });
      stubHub(device);
      const pending = signer.acceptDeviceLink(SID);
      for (let i = 0; i < 10 && !releaseLink; i++) await new Promise((resolve) => setImmediate(resolve));
      const sign = await signer.signFabricUri(signRequestFor(device, { now: clock }).sign.uri);
      assert.strictEqual(sign.status, 200, 'a waiting link prompt does not block sign-in');
      releaseLink(false);
      assert.strictEqual((await pending).status, 403);
      assert.strictEqual((await signer.acceptDeviceLink(SID)).status, 429);
      clock += 30 * 1000;
      const again = signer.acceptDeviceLink(SID);
      for (let i = 0; i < 10; i++) await new Promise((resolve) => setImmediate(resolve));
      releaseLink(true);
      assert.strictEqual((await again).status, 200);
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
