'use strict';

const assert = require('assert');
const http = require('http');
const Delegation = require('@fabric/core/types/delegation');
const { FIXTURE_SEED } = require('@fabric/core/constants');
const { importSeed, deriveAccount } = require('@fabric/core/functions/accountKeys');
const { createChallenge, verifyAssertion } = require('@fabric/core/functions/passport');
const d = require('@fabric/core/functions/delegation');
const { createDelegationRendezvous } = require('../functions/fabricDelegationHttp');
const { createDelegationMailbox } = require('../functions/fabricDelegationMailbox');
const { createFabricDelegate } = require('../functions/fabricDelegate');
const client = require('../functions/fabricDelegationClient');

const MASTER = importSeed(FIXTURE_SEED);
const PASSPORT = deriveAccount(MASTER, { account: 0, network: 'regtest' });
const HUB = deriveAccount(MASTER, { account: 1, network: 'regtest' });
const OTHER = deriveAccount(MASTER, { account: 2, network: 'regtest' });
const SITE = 'https://goon.vc';
const EXTENSION = 'moz-extension://0b5c2a4e-1111-2222-3333-444455556666';
const STRANGER = 'moz-extension://99999999-1111-2222-3333-444455556666';

function serve (handle) {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      Promise.resolve(handle(req, res)).then((done) => {
        if (done === false) { res.statusCode = 404; res.end('{}'); }
      });
    });
    server.listen(0, '127.0.0.1', () => resolve({ server, origin: `http://127.0.0.1:${server.address().port}` }));
  });
}

function send (origin, method, path, { body, headers } = {}) {
  const url = new URL(path, origin);
  return new Promise((resolve, reject) => {
    const req = http.request(url, { method, headers: Object.assign({ 'Content-Type': 'application/json' }, headers || {}) }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        resolve({ status: res.statusCode, body: text ? JSON.parse(text) : {} });
      });
    });
    req.on('error', reject);
    if (body !== undefined) req.write(JSON.stringify(body));
    req.end();
  });
}

describe('@fabric/http delegation transports', function () {
  this.timeout(30000);
  const servers = [];
  afterEach(function () {
    while (servers.length) servers.pop().close();
  });

  describe('rendezvous', function () {
    it('relays a whole pairing and the grants after it, in order only', async function () {
      const rendezvous = createDelegationRendezvous();
      const { server, origin } = await serve(rendezvous.handle);
      servers.push(server);
      const passport = new Delegation({ key: PASSPORT.identity.key });
      const hub = new Delegation({ key: HUB.identity.key });

      const offer = await passport.offer({ origin, label: 'Passport' });
      const opened = await client.openLink(origin, offer.uri);
      assert.strictEqual(opened.httpStatus, 201, opened.error);
      assert.strictEqual(opened.id, offer.linkId);
      assert.strictEqual((await client.openLink(origin, offer.uri)).httpStatus, 409);

      const early = await passport.offer({ origin });
      await client.openLink(origin, early.uri);
      const strayReveal = await client.postLinkFrame(origin, early.linkId, offer.uri);
      assert.strictEqual(strayReveal.httpStatus, 400);

      const seen = await client.readLink(origin, offer.linkId);
      const answer = await hub.answer(seen.frames[0], { label: 'Hub' });
      assert.strictEqual((await client.postLinkFrame(origin, offer.linkId, answer.uri)).httpStatus, 201);
      const intruder = new Delegation({ key: OTHER.identity.key });
      const second = await intruder.answer(seen.frames[0]);
      assert.strictEqual((await client.postLinkFrame(origin, offer.linkId, second.uri)).httpStatus, 409);

      const afterAnswer = await client.waitForLinkFrames(origin, offer.linkId, 1, { intervalMs: 10 });
      const revealed = await passport.receive(afterAnswer.frames[1]);
      assert.strictEqual(revealed.ok, true, revealed.error);
      const posted = await client.postLinkFrame(origin, offer.linkId, revealed.reveal);
      assert.strictEqual(posted.httpStatus, 201, posted.error);
      assert.strictEqual(posted.status, 'revealed');

      const confirmed = await hub.receive(posted.frames[2]);
      assert.strictEqual(confirmed.sas, revealed.sas);
      await hub.confirmLink(offer.linkId);
      await passport.confirmLink(offer.linkId);
      const link = (await hub.links())[0];

      const grant = await hub.grant({ grantee: PASSPORT.identity.pubkey, scopes: ['passport'], link: link.revealHash });
      assert.strictEqual((await client.postLinkFrame(origin, offer.linkId, grant.uri)).httpStatus, 201);
      const foreign = await new Delegation({ key: OTHER.identity.key }).grant({ grantee: PASSPORT.identity.pubkey, scopes: ['passport'] });
      assert.strictEqual((await client.postLinkFrame(origin, offer.linkId, foreign.uri)).httpStatus, 403);

      const all = await client.readLink(origin, offer.linkId);
      assert.strictEqual(all.frames.length, 4);
      assert.strictEqual((await passport.receive(all.frames[3])).ok, true);
    });

    it('refuses offers for another rendezvous, and cancels only for a participant', async function () {
      const rendezvous = createDelegationRendezvous({ origins: ['https://hub.fabric.pub'] });
      const passport = new Delegation({ key: PASSPORT.identity.key });
      const elsewhere = await passport.offer({ origin: 'https://hub.goon.vc' });
      assert.strictEqual(rendezvous.create(elsewhere.uri).status, 403);
      const here = await passport.offer({ origin: 'https://hub.fabric.pub' });
      assert.strictEqual(rendezvous.create(here.uri).status, 201);
      const stranger = d.createMailboxFetch({}, OTHER.identity.key);
      assert.strictEqual(rendezvous.cancel(here.linkId, stranger.uri).status, 403);
      const mine = d.createMailboxFetch({}, PASSPORT.identity.key);
      assert.strictEqual(rendezvous.cancel(here.linkId, mine.uri).status, 200);
      assert.strictEqual(rendezvous.read(here.linkId).status, 404);
    });
  });

  describe('mailbox', function () {
    it('keeps frames for their addressee, read back once per fetch', async function () {
      const mailbox = createDelegationMailbox();
      const { server, origin } = await serve(mailbox.handle);
      servers.push(server);
      const hub = new Delegation({ key: HUB.identity.key });
      const grant = await hub.grant({ grantee: PASSPORT.identity.pubkey, scopes: ['message'] });
      const posted = await client.postMailbox(origin, grant.uri);
      assert.strictEqual(posted.httpStatus, 201, posted.error);
      assert.strictEqual((await client.postMailbox(origin, grant.uri)).duplicate, true);

      const proof = d.createMailboxFetch({}, PASSPORT.identity.key);
      const got = await client.fetchMailbox(origin, proof.uri);
      assert.strictEqual(got.httpStatus, 200, got.error);
      assert.strictEqual(got.frames.length, 1);
      assert.strictEqual(got.frames[0].type, 'DELEGATION_GRANT');
      assert.strictEqual((await client.fetchMailbox(origin, proof.uri)).httpStatus, 409);

      const later = d.createMailboxFetch({ since: got.next }, PASSPORT.identity.key);
      assert.strictEqual((await client.fetchMailbox(origin, later.uri)).frames.length, 0);
      const theirs = d.createMailboxFetch({}, OTHER.identity.key);
      assert.strictEqual((await client.fetchMailbox(origin, theirs.uri)).frames.length, 0);
      assert.strictEqual((await send(origin, 'GET', '/services/delegation/mailbox')).status, 401);
    });

    it('needs `to` for results, and hands the host its own frames', async function () {
      const taken = [];
      const mailbox = createDelegationMailbox({ deliver: (to, buffer) => { if (to === HUB.identity.pubkey.slice(2)) { taken.push(buffer); return true; } return false; } });
      const passport = new Delegation({ key: PASSPORT.identity.key });
      const hub = new Delegation({ key: HUB.identity.key });
      const grant = await hub.grant({ grantee: PASSPORT.identity.pubkey, scopes: ['message'] });
      await passport.receive(grant.uri);
      const msg = require('@fabric/core/types/message').fromVector(['P2P_CHAT_MESSAGE', 'hello']);
      const req = await passport.request({ target: HUB.identity.pubkey, request: msg.toBuffer() });
      const delivered = await mailbox.post(req.uri);
      assert.strictEqual(delivered.body.delivered, true);
      assert.strictEqual(taken.length, 1);

      await hub.receive(req.uri);
      const result = await hub.decline(req.hash, 'not now');
      assert.strictEqual((await mailbox.post(result.uri)).status, 400);
      assert.strictEqual((await mailbox.post(result.uri, { to: PASSPORT.identity.pubkey })).status, 201);
    });
  });

  describe('local delegate', function () {
    async function setup (options = {}) {
      const hub = new Delegation({ key: HUB.identity.key });
      const prompts = [];
      const delegate = createFabricDelegate(Object.assign({
        delegation: hub,
        signer: 'hub',
        network: 'regtest',
        name: 'Hub',
        getAccount: () => HUB,
        confirmLink: async (p) => { prompts.push(p); return true; }
      }, options));
      const { server, origin } = await serve((req, res) => delegate.handle(req, res));
      servers.push(server);
      return { hub, delegate, origin, prompts };
    }

    async function pair (origin, passport) {
      const headers = { origin: EXTENSION };
      const offer = await passport.offer({ origin, label: 'Passport' });
      const answered = await send(origin, 'POST', '/services/delegation/links', { body: { frame: offer.uri }, headers });
      assert.strictEqual(answered.status, 201, answered.body.error);
      const revealed = await passport.receive(answered.body.frame);
      const confirmed = await send(origin, 'POST', '/services/delegation/links', { body: { frame: revealed.reveal }, headers });
      assert.strictEqual(confirmed.status, 200, confirmed.body.error);
      assert.strictEqual(confirmed.body.sas, revealed.sas);
      const link = await passport.confirmLink(offer.linkId);
      const mine = await passport.grant({ grantee: HUB.identity.pubkey, scopes: ['identity'], link: link.revealHash, extensionOrigin: EXTENSION });
      const granted = await send(origin, 'POST', '/services/delegation/links', { body: { frame: mine.uri }, headers });
      assert.strictEqual(granted.status, 200, granted.body.error);
      for (const g of granted.body.grants) assert.strictEqual((await passport.receive(g)).ok, true);
      return granted.body.grants;
    }

    it('pairs with Passport, shows the code, and grants back', async function () {
      const { hub, origin, prompts } = await setup();
      const passport = new Delegation({ key: PASSPORT.identity.key });
      const grants = await pair(origin, passport);
      assert.strictEqual(grants.length, 1);
      assert.strictEqual(prompts.length, 1);
      assert.match(prompts[0].sas, /^[0-9]{6}$/);
      assert.deepStrictEqual(await hub.identityPeers(), [PASSPORT.identity.pubkey]);
      const described = await send(origin, 'GET', `/services/delegation?pubkey=${PASSPORT.identity.pubkey}`, { headers: { origin: EXTENSION } });
      assert.strictEqual(described.body.granted, true);
      const asStranger = await send(origin, 'GET', `/services/delegation?pubkey=${PASSPORT.identity.pubkey}`, { headers: { origin: STRANGER } });
      assert.strictEqual(asStranger.body.granted, false);
    });

    it('lets the first Firefox Passport pair, then refuses a different one', async function () {
      const fresh = await setup();
      const opener = new Delegation({ key: OTHER.identity.key });
      const opened = await send(fresh.origin, 'POST', '/services/delegation/links', {
        body: { frame: (await opener.offer({ origin: fresh.origin, label: 'Other' })).uri },
        headers: { origin: STRANGER }
      });
      assert.strictEqual(opened.status, 201, opened.body.error);

      const { origin } = await setup();
      const passport = new Delegation({ key: PASSPORT.identity.key });
      await pair(origin, passport);
      const later = await send(origin, 'POST', '/services/delegation/links', {
        body: { frame: (await opener.offer({ origin, label: 'Other' })).uri },
        headers: { origin: STRANGER }
      });
      assert.strictEqual(later.status, 403);
    });

    it('answers a sign-in when `decide` says sign, and only for the granted origin', async function () {
      const { origin } = await setup({ decide: () => ({ action: 'sign', rule: 'sites' }) });
      const passport = new Delegation({ key: PASSPORT.identity.key });
      await pair(origin, passport);
      const c = createChallenge({ origin: SITE, network: 'regtest' });
      const req = await passport.request({ target: HUB.identity.pubkey, request: c.uri, origin: SITE });

      const stranger = await send(origin, 'POST', '/services/delegation/requests', { body: { frame: req.uri }, headers: { origin: STRANGER } });
      assert.strictEqual(stranger.status, 403);

      const out = await send(origin, 'POST', '/services/delegation/requests', { body: { frame: req.uri }, headers: { origin: EXTENSION } });
      assert.strictEqual(out.status, 200, out.body.error);
      assert.strictEqual(out.body.status, 'signed');
      const got = await passport.receive(out.body.result);
      assert.strictEqual(got.ok, true, got.error);
      const verified = verifyAssertion(got.result.answer.uri, { origin: SITE, nonce: c.nonce, challengeHash: c.hash, network: 'regtest', allow: c.request, challengeExpiresAt: c.expiresAt });
      assert.strictEqual(verified.ok, true, verified.error);

      const again = await send(origin, 'POST', '/services/delegation/requests', { body: { frame: req.uri }, headers: { origin: EXTENSION } });
      assert.strictEqual(again.body.status, 'signed');
    });

    it('holds a request for the user by default, and declines when told', async function () {
      let verdict = 'notify';
      const { hub, origin } = await setup({ decide: () => verdict });
      const passport = new Delegation({ key: PASSPORT.identity.key });
      await pair(origin, passport);
      const headers = { origin: EXTENSION };
      const c = createChallenge({ origin: SITE, network: 'regtest' });
      const req = await passport.request({ target: HUB.identity.pubkey, request: c.uri, origin: SITE });
      const held = await send(origin, 'POST', '/services/delegation/requests', { body: { frame: req.uri }, headers });
      assert.strictEqual(held.status, 202);
      assert.strictEqual(held.body.status, 'pending');
      assert.strictEqual((await hub.pending()).length, 1);
      await hub.decline(req.hash, 'not me');
      const polled = await send(origin, 'GET', `/services/delegation/requests/${req.hash}`, { headers });
      assert.strictEqual(polled.body.status, 'declined');

      verdict = 'decline';
      const c2 = createChallenge({ origin: SITE, network: 'regtest' });
      const req2 = await passport.request({ target: HUB.identity.pubkey, request: c2.uri, origin: SITE });
      const refused = await send(origin, 'POST', '/services/delegation/requests', { body: { frame: req2.uri }, headers });
      assert.strictEqual(refused.body.status, 'declined');
    });

    it('settles held requests later, and takes requests that came by mailbox', async function () {
      let verdict = 'notify';
      const { delegate, origin } = await setup({ decide: () => verdict });
      const passport = new Delegation({ key: PASSPORT.identity.key });
      await pair(origin, passport);
      const c = createChallenge({ origin: SITE, network: 'regtest' });
      const req = await passport.request({ target: HUB.identity.pubkey, request: c.uri, origin: SITE });
      const held = await delegate.takeRemote(req.uri);
      assert.strictEqual(held.status, 202);
      const signed = await delegate.resolve(req.hash, { action: 'sign', rule: 'operator' });
      assert.strictEqual(signed.json.status, 'signed');
      assert.strictEqual((await passport.receive(signed.json.result)).ok, true);
      const again = await delegate.resolve(req.hash, 'decline');
      assert.strictEqual(again.json.status, 'signed', 'a settled request stays settled');
      assert.strictEqual(again.json.alreadySettled, true);
      assert.strictEqual((await delegate.resolve('ab'.repeat(32), 'sign')).status, 404);

      verdict = 'decline';
      const c2 = createChallenge({ origin: SITE, network: 'regtest' });
      const req2 = await passport.request({ target: HUB.identity.pubkey, request: c2.uri, origin: SITE });
      assert.strictEqual((await delegate.takeRemote(req2.uri)).json.status, 'declined');

      const stranger = new Delegation({ key: OTHER.identity.key });
      const offer = await stranger.offer({ origin: SITE });
      assert.strictEqual((await delegate.takeRemote(offer.uri)).status, 403, 'pairing never comes by mailbox');
    });

    it('turns away older Passports, web pages, and proxied callers', async function () {
      const { origin } = await setup();
      const challenge = createChallenge({ origin: SITE, network: 'regtest' });
      const old = await send(origin, 'POST', '/services/delegation/requests', { body: { frame: challenge.uri }, headers: { origin: EXTENSION } });
      assert.strictEqual(old.status, 426);
      assert.strictEqual(old.body.error, 'passport_outdated');
      const page = await send(origin, 'POST', '/services/delegation/requests', { body: { frame: challenge.uri }, headers: { origin: SITE } });
      assert.strictEqual(page.status, 403);
      const proxied = await send(origin, 'POST', '/services/delegation/requests', { body: { frame: challenge.uri }, headers: { origin: EXTENSION, 'x-forwarded-for': '203.0.113.9' } });
      assert.strictEqual(proxied.status, 403);
      const chrome = await send(origin, 'POST', '/services/delegation/links', { body: { frame: (await new Delegation({ key: PASSPORT.identity.key }).offer({ origin })).uri }, headers: { origin: 'chrome-extension://abcdefghijklmnopabcdefghijklmnop' } });
      assert.strictEqual(chrome.status, 403, 'a Chrome id must be configured');
    });

    it('does not give grants when the user does not confirm the code', async function () {
      const { hub, origin } = await setup({ confirmLink: async () => false });
      const passport = new Delegation({ key: PASSPORT.identity.key });
      const headers = { origin: EXTENSION };
      const offer = await passport.offer({ origin });
      const answered = await send(origin, 'POST', '/services/delegation/links', { body: { frame: offer.uri }, headers });
      const revealed = await passport.receive(answered.body.frame);
      const refused = await send(origin, 'POST', '/services/delegation/links', { body: { frame: revealed.reveal }, headers });
      assert.strictEqual(refused.status, 403);
      const link = await passport.confirmLink(offer.linkId);
      const mine = await passport.grant({ grantee: HUB.identity.pubkey, scopes: ['identity'], link: link.revealHash, extensionOrigin: EXTENSION });
      const granted = await send(origin, 'POST', '/services/delegation/links', { body: { frame: mine.uri }, headers });
      assert.strictEqual(granted.status, 403);
      assert.deepStrictEqual(await hub.grants('given'), []);
    });
  });
});
