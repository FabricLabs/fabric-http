'use strict';

const assert = require('assert');
const http = require('http');
const Delegation = require('@fabric/core/types/delegation');
const d = Delegation;
const { FIXTURE_SEED } = require('@fabric/core/constants');
const { importSeed, deriveAccount } = require('@fabric/core/functions/accountKeys');
const { createChallenge, verifyAssertion } = require('@fabric/core/functions/passport');
const { createDelegationRendezvous, createDelegationMailbox } = require('../functions/fabricDelegationHttp');
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

    it('refuses a pairing cancel with a proof already spent reading the mailbox', async function () {
      const rendezvous = createDelegationRendezvous();
      const mailbox = createDelegationMailbox();
      const here = await new Delegation({ key: PASSPORT.identity.key }).offer({ origin: 'https://hub.fabric.pub' });
      assert.strictEqual(rendezvous.create(here.uri).status, 201);
      const proof = d.createMailboxFetch({}, PASSPORT.identity.key);
      assert.strictEqual((await mailbox.fetch(proof.uri)).status, 200);
      assert.strictEqual(rendezvous.cancel(here.linkId, proof.uri).status, 409);
      assert.strictEqual(rendezvous.read(here.linkId).status, 200, 'the pairing is still open');
    });

    it('rate-limits reads of a link', async function () {
      const rendezvous = createDelegationRendezvous();
      const { server, origin } = await serve(rendezvous.handle);
      servers.push(server);
      const offer = await new Delegation({ key: PASSPORT.identity.key }).offer({ origin });
      assert.strictEqual((await client.openLink(origin, offer.uri)).httpStatus, 201);
      for (let i = 0; i < 360; i++) {
        assert.strictEqual((await send(origin, 'GET', `/delegations/${offer.linkId}`)).status, 200);
      }
      assert.strictEqual((await send(origin, 'GET', `/delegations/${offer.linkId}`)).status, 429);
    });
  });

  describe('client grouping', function () {
    const { clientGroup } = require('../functions/httpRequestTrust');

    it('reads an IPv4-mapped address in hex form as IPv4', function () {
      assert.strictEqual(clientGroup('::ffff:c000:0201'), '192.0.2.1');
      assert.strictEqual(clientGroup('::ffff:192.0.2.1'), '192.0.2.1');
      assert.strictEqual(clientGroup('0:0:0:0:0:ffff:c000:201'), '192.0.2.1');
    });

    it('counts a dotted IPv4 tail as two groups', function () {
      assert.strictEqual(clientGroup('64:ff9b::1.2.3.4'), '64:ff9b:0:0::/64');
      assert.strictEqual(clientGroup('2001:db8:1:2:3:4:1.2.3.4'), '2001:db8:1:2::/64');
      assert.strictEqual(clientGroup('2001:db8::1'), '2001:db8:0:0::/64');
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

    it('keeps a mailbox that is still loading, and remembers a used fetch', async function () {
      let release;
      const gate = new Promise((resolve) => { release = resolve; });
      const persisted = {
        seq: 3,
        boxes: {
          aa: [{ seq: 3, hash: 'cd'.repeat(32), type: 'DELEGATION_GRANT', hex: '00', at: 1, until: Date.now() + 60 * 60 * 1000 }]
        },
        spent: {}
      };
      const store = {
        async get () { await gate; return JSON.stringify(persisted); },
        async set (_key, value) { persisted.raw = value; }
      };
      const mailbox = createDelegationMailbox({ store });
      const hub = new Delegation({ key: HUB.identity.key });
      const grant = await hub.grant({ grantee: PASSPORT.identity.pubkey, scopes: ['message'] });
      const posting = mailbox.post(grant.uri);
      await new Promise((resolve) => setTimeout(resolve, 20));
      assert.strictEqual(persisted.raw, undefined);
      release();
      const posted = await posting;
      assert.strictEqual(posted.status, 201, posted.body.error);
      const saved = JSON.parse(persisted.raw);
      assert.ok(saved.boxes.aa, 'the stored frame is still there');
      assert.ok(Object.keys(saved.boxes).length >= 2);

      const proof = d.createMailboxFetch({}, PASSPORT.identity.key);
      assert.strictEqual((await mailbox.fetch(proof.uri)).status, 200);
      const restarted = createDelegationMailbox({
        spentNonces: new Map(),
        store: {
          async get () { return persisted.raw; },
          async set () {}
        }
      });
      assert.strictEqual((await restarted.fetch(proof.uri)).status, 409);
    });

    it('refuses to queue while the stored mailbox cannot be read, then keeps it', async function () {
      const persisted = {
        raw: JSON.stringify({
          seq: 3,
          boxes: { aa: [{ seq: 3, hash: 'cd'.repeat(32), type: 'DELEGATION_GRANT', hex: '00', at: 1, until: Date.now() + 60 * 60 * 1000 }] },
          spent: {}
        })
      };
      let failing = true;
      let writes = 0;
      const store = {
        async get () {
          if (failing) throw new Error('disk busy');
          return persisted.raw;
        },
        async set (_key, value) { writes++; persisted.raw = value; }
      };
      const mailbox = createDelegationMailbox({ store });
      const hub = new Delegation({ key: HUB.identity.key });
      const grant = await hub.grant({ grantee: PASSPORT.identity.pubkey, scopes: ['message'] });
      await assert.rejects(() => mailbox.post(grant.uri), (err) => err.status === 503);
      assert.strictEqual(writes, 0);
      failing = false;
      const posted = await mailbox.post(grant.uri);
      assert.strictEqual(posted.status, 201, posted.body.error);
      assert.strictEqual(posted.body.seq, 4);
      const saved = JSON.parse(persisted.raw);
      assert.ok(saved.boxes.aa, 'the stored frame is still there');
    });

    async function grantsFor (count) {
      const hub = new Delegation({ key: HUB.identity.key });
      const grants = [];
      for (let i = 0; i < count; i++) grants.push(await hub.grant({ grantee: PASSPORT.identity.pubkey, scopes: ['message'], label: `grant ${i}` }));
      return grants;
    }

    async function hubGrant () {
      return new Delegation({ key: HUB.identity.key }).grant({ grantee: PASSPORT.identity.pubkey, scopes: ['message'], label: 'passport' });
    }

    async function queue (mailbox, grant, from) {
      const out = await mailbox.post(grant.uri, { from });
      assert.strictEqual(out.status, 201, out.body.error);
      return out.body.hash;
    }

    async function queued (mailbox) {
      const got = await mailbox.fetch(d.createMailboxFetch({}, PASSPORT.identity.key).uri);
      return got.body.frames.map((f) => f.hash);
    }

    it('drops frames the addressee read past, and makes room for every sender', async function () {
      const mailbox = createDelegationMailbox({ maxPerAddress: 4 });
      const grants = await grantsFor(7);
      await queue(mailbox, grants[0], 'a');
      const a = await queue(mailbox, grants[1], 'a');
      const b = await queue(mailbox, grants[2], 'b');
      const c = await queue(mailbox, grants[3], 'c');
      await queue(mailbox, grants[4], 'd');
      const e = await queue(mailbox, grants[5], 'e');

      const first = await mailbox.fetch(d.createMailboxFetch({}, PASSPORT.identity.key).uri);
      assert.deepStrictEqual(first.body.frames.map((f) => f.hash), [a, b, c, e], 'a kept one frame; on a tie the sender heard from last (d) gave way to e');
      const acknowledged = await mailbox.fetch(d.createMailboxFetch({ since: first.body.next }, PASSPORT.identity.key).uri);
      assert.strictEqual(acknowledged.body.frames.length, 0);
      const again = await queue(mailbox, grants[6], 'a');
      assert.deepStrictEqual(await queued(mailbox), [again]);
    });

    it('keeps a queued revoke while new senders fill the box', async function () {
      const mailbox = createDelegationMailbox({ maxPerAddress: 4 });
      const hub = new Delegation({ key: HUB.identity.key });
      const revoked = await hub.grant({ grantee: PASSPORT.identity.pubkey, scopes: ['message'], label: 'revoked' });
      const revoke = await hub.revoke(revoked.hash);
      const posted = await mailbox.post(revoke.uri, { to: PASSPORT.identity.pubkey, from: 'r' });
      assert.strictEqual(posted.status, 201, posted.body.error);
      const grants = await grantsFor(12);
      for (let i = 0; i < grants.length; i++) await queue(mailbox, grants[i], `flood-${i}`);
      assert.ok((await queued(mailbox)).includes(posted.body.hash), 'the revoke is still queued');
    });

    it('a sender drops its own oldest non-revoke frame first', async function () {
      const mailbox = createDelegationMailbox({ maxPerAddress: 8 });
      const hub = new Delegation({ key: HUB.identity.key });
      const revoked = await hub.grant({ grantee: PASSPORT.identity.pubkey, scopes: ['message'], label: 'revoked' });
      const revoke = await mailbox.post((await hub.revoke(revoked.hash)).uri, { to: PASSPORT.identity.pubkey, from: 'hub' });
      const grants = await grantsFor(2);
      const first = await queue(mailbox, grants[0], 'hub');
      const second = await queue(mailbox, grants[1], 'hub');
      assert.deepStrictEqual(await queued(mailbox), [revoke.body.hash, second], 'the revoke stays; the oldest grant went');
      assert.ok(!(await queued(mailbox)).includes(first));
    });

    it('a sender opens only its share of boxes, and a full table drops the busiest sender\'s newest box', async function () {
      const hub = new Delegation({ key: HUB.identity.key });
      const grantTo = async (i) => hub.grant({ grantee: deriveAccount(MASTER, { account: 10 + i, network: 'regtest' }).identity.pubkey, scopes: ['message'], label: `box ${i}` });
      const capped = createDelegationMailbox({ maxAddresses: 32 });
      assert.strictEqual((await capped.post((await grantTo(0)).uri, { from: 'flood' })).status, 201);
      assert.strictEqual((await capped.post((await grantTo(1)).uri, { from: 'flood' })).status, 201);
      const refused = await capped.post((await grantTo(2)).uri, { from: 'flood' });
      assert.strictEqual(refused.status, 429, 'a sender may open maxAddresses / 16 boxes');

      const table = createDelegationMailbox({ maxAddresses: 4 });
      const revoke = await hub.revoke((await grantTo(3)).hash);
      const kept = await table.post(revoke.uri, { to: deriveAccount(MASTER, { account: 13, network: 'regtest' }).identity.pubkey, from: 'a' });
      assert.strictEqual(kept.status, 201, kept.body.error);
      for (const [i, from] of [[4, 'b'], [5, 'c'], [6, 'd']]) assert.strictEqual((await table.post((await grantTo(i)).uri, { from })).status, 201);
      const passport = await table.post((await hubGrant()).uri, { from: 'e' });
      assert.strictEqual(passport.status, 201, 'a full table makes room instead of refusing');
      assert.strictEqual(passport.body.ok, true);
    });

    it('does not acknowledge a frame whose write failed, even when posts overlap', async function () {
      let fail = true;
      const store = {
        async get () { return null; },
        async set () { if (fail) throw new Error('disk full'); }
      };
      const mailbox = createDelegationMailbox({ store });
      const grants = await grantsFor(2);
      const results = await Promise.allSettled([mailbox.post(grants[0].uri), mailbox.post(grants[1].uri)]);
      assert.deepStrictEqual(results.map((r) => r.status), ['rejected', 'rejected']);
      fail = false;
      const retried = await mailbox.post(grants[0].uri);
      assert.strictEqual(retried.status, 201, 'the retry is stored, not reported as a duplicate');
      assert.deepStrictEqual(await queued(mailbox), [retried.body.hash]);
    });

    it('counts an IPv6 sender by its /64, and an IPv4-mapped one as IPv4', async function () {
      const mailbox = createDelegationMailbox({ maxPerAddress: 4 });
      const grants = await grantsFor(5);
      await queue(mailbox, grants[0], '2001:db8::1');
      const sameNet = await queue(mailbox, grants[1], '2001:db8:0:0:ffff::2');
      const otherNet = await queue(mailbox, grants[2], '2001:db8:0:1::1');
      await queue(mailbox, grants[3], '::ffff:10.0.0.1');
      const v4 = await queue(mailbox, grants[4], '10.0.0.1');
      assert.deepStrictEqual(await queued(mailbox), [sameNet, otherNet, v4]);
    });

    it('keeps counting a sender after a restart, without saving its address', async function () {
      const persisted = { raw: null };
      const store = {
        async get () { return persisted.raw; },
        async set (_key, value) { persisted.raw = value; }
      };
      const grants = await grantsFor(2);
      await queue(createDelegationMailbox({ store, maxPerAddress: 4 }), grants[0], '203.0.113.7');
      assert.ok(!persisted.raw.includes('203.0.113.7'));
      const restarted = createDelegationMailbox({ store, maxPerAddress: 4 });
      const latest = await queue(restarted, grants[1], '203.0.113.7');
      assert.deepStrictEqual(await queued(restarted), [latest]);
      assert.ok(!persisted.raw.includes('203.0.113.7'));
    });

    it('answers 503 when the mailbox cannot be saved', async function () {
      const mailbox = createDelegationMailbox({
        store: {
          async get () { return null; },
          async set () { throw new Error('disk full'); }
        }
      });
      const [grant] = await grantsFor(1);
      await assert.rejects(() => mailbox.post(grant.uri, { from: 'a' }), (err) => err.status === 503);
      const proof = d.createMailboxFetch({}, PASSPORT.identity.key);
      await assert.rejects(() => mailbox.fetch(proof.uri), (err) => err.status === 503);
      assert.strictEqual((await mailbox.fetch(proof.uri)).status, 409, 'the fetch stays used');
    });

    it('stores a retry after a failed save instead of calling it a duplicate', async function () {
      const persisted = { raw: null, fail: false };
      const mailbox = createDelegationMailbox({
        store: {
          async get () { return persisted.raw; },
          async set (_key, value) {
            if (persisted.fail) throw new Error('disk full');
            persisted.raw = value;
          }
        }
      });
      const [grant] = await grantsFor(1);
      await mailbox.load();
      persisted.fail = true;
      await assert.rejects(() => mailbox.post(grant.uri, { from: 'a' }), (err) => err.status === 503);
      persisted.fail = false;
      const retry = await mailbox.post(grant.uri, { from: 'a' });
      assert.strictEqual(retry.status, 201);
      assert.strictEqual(retry.body.seq, 1, 'the failed post does not use up a sequence number');
      assert.ok(JSON.parse(persisted.raw).boxes[PASSPORT.identity.pubkey.slice(2)], 'the retry is saved');
    });

    it('rate-limits fetches apart from posts', async function () {
      const mailbox = createDelegationMailbox({ postsPerMinute: 1 });
      const { server, origin } = await serve(mailbox.handle);
      servers.push(server);
      const hub = new Delegation({ key: HUB.identity.key });
      const grant = await hub.grant({ grantee: PASSPORT.identity.pubkey, scopes: ['message'] });
      assert.strictEqual((await client.postMailbox(origin, grant.uri)).httpStatus, 201);
      for (let i = 0; i < 3; i++) {
        const proof = d.createMailboxFetch({}, PASSPORT.identity.key);
        assert.strictEqual((await client.fetchMailbox(origin, proof.uri)).httpStatus, 200);
      }
      assert.strictEqual((await client.postMailbox(origin, grant.uri)).httpStatus, 429);
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

    it('refuses a reveal from another origin before taking it, so the right one still pairs', async function () {
      const { hub, origin, prompts } = await setup();
      const passport = new Delegation({ key: PASSPORT.identity.key });
      const links = '/services/delegation/links';
      const offer = await passport.offer({ origin, label: 'Passport' });
      const answered = await send(origin, 'POST', links, { body: { frame: offer.uri }, headers: { origin: EXTENSION } });
      assert.strictEqual(answered.status, 201, answered.body.error);
      const revealed = await passport.receive(answered.body.frame);
      const elsewhere = await send(origin, 'POST', links, { body: { frame: revealed.reveal }, headers: { origin: STRANGER } });
      assert.strictEqual(elsewhere.status, 403);
      assert.strictEqual((await hub.links())[0].status, 'answered', 'the reveal was not taken');
      const confirmed = await send(origin, 'POST', links, { body: { frame: revealed.reveal }, headers: { origin: EXTENSION } });
      assert.strictEqual(confirmed.status, 200, confirmed.body.error);
      assert.strictEqual(prompts.length, 1);
    });

    it('accepts one pairing offer at a time', async function () {
      const { origin } = await setup();
      const passport = new Delegation({ key: PASSPORT.identity.key });
      const headers = { origin: EXTENSION };
      const first = await passport.offer({ origin, label: 'Passport' });
      assert.strictEqual((await send(origin, 'POST', '/services/delegation/links', { body: { frame: first.uri }, headers })).status, 201);
      const second = await passport.offer({ origin, label: 'Passport' });
      assert.strictEqual((await send(origin, 'POST', '/services/delegation/links', { body: { frame: second.uri }, headers })).status, 429);
    });

    it('shows a code only for the latest offer, and only once', async function () {
      let clock = Date.now();
      const { origin, prompts } = await setup({ now: () => clock });
      const passport = new Delegation({ key: PASSPORT.identity.key });
      const headers = { origin: EXTENSION };
      const links = '/services/delegation/links';
      const first = await passport.offer({ origin, label: 'Passport' });
      const firstAnswer = await send(origin, 'POST', links, { body: { frame: first.uri }, headers });
      assert.strictEqual(firstAnswer.status, 201, firstAnswer.body.error);
      clock += 31 * 1000;
      const second = await passport.offer({ origin, label: 'Passport' });
      const secondAnswer = await send(origin, 'POST', links, { body: { frame: second.uri }, headers });
      assert.strictEqual(secondAnswer.status, 201, secondAnswer.body.error);

      const stale = await passport.receive(firstAnswer.body.frame);
      assert.strictEqual((await send(origin, 'POST', links, { body: { frame: stale.reveal }, headers })).status, 403);
      const fresh = await passport.receive(secondAnswer.body.frame);
      assert.strictEqual((await send(origin, 'POST', links, { body: { frame: fresh.reveal }, headers })).status, 200);
      assert.notStrictEqual((await send(origin, 'POST', links, { body: { frame: fresh.reveal }, headers })).status, 200);
      assert.strictEqual(prompts.length, 1);
    });

    it('keeps one pairing prompt open at a time, and waits the interval after it', async function () {
      let clock = Date.now();
      let release;
      const gate = new Promise((resolve) => { release = resolve; });
      const prompts = [];
      const { origin } = await setup({ now: () => clock, confirmLink: async (p) => { prompts.push(p); await gate; return true; } });
      const passport = new Delegation({ key: PASSPORT.identity.key });
      const headers = { origin: EXTENSION };
      const links = '/services/delegation/links';
      const offer = await passport.offer({ origin, label: 'Passport' });
      const answer = await send(origin, 'POST', links, { body: { frame: offer.uri }, headers });
      assert.strictEqual(answer.status, 201, answer.body.error);
      const revealed = await passport.receive(answer.body.frame);
      clock += 31 * 1000;

      const open = send(origin, 'POST', links, { body: { frame: revealed.reveal }, headers });
      while (!prompts.length) await new Promise((resolve) => setTimeout(resolve, 5));
      assert.strictEqual((await send(origin, 'POST', links, { body: { frame: revealed.reveal }, headers })).status, 429);
      const during = await passport.offer({ origin, label: 'Passport' });
      assert.strictEqual((await send(origin, 'POST', links, { body: { frame: during.uri }, headers })).status, 429, 'no new offer while a prompt is open');
      release();
      assert.strictEqual((await open).status, 200);
      assert.strictEqual(prompts.length, 1);

      const soon = await passport.offer({ origin, label: 'Passport' });
      assert.strictEqual((await send(origin, 'POST', links, { body: { frame: soon.uri }, headers })).status, 429, 'the interval counts from the prompt');
      clock += 31 * 1000;
      const later = await passport.offer({ origin, label: 'Passport' });
      assert.strictEqual((await send(origin, 'POST', links, { body: { frame: later.uri }, headers })).status, 201);
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
