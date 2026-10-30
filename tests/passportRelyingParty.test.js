'use strict';

const assert = require('assert');
const { FIXTURE_SEED } = require('@fabric/core/constants');
const { importSeed, deriveAccount } = require('@fabric/core/functions/accountKeys');
const { signAssertion } = require('@fabric/core/functions/passport');
const {
  hashSecret,
  createMemoryStore,
  createPassportRelyingParty
} = require('../functions/passportRelyingParty');

const SITE = 'https://site.example';
const OTHER_SITE = 'https://other.example';
const ACCOUNT = deriveAccount(importSeed(FIXTURE_SEED), { account: 0, network: 'regtest' });

function sign (issued, params = {}) {
  return signAssertion(Object.assign({
    challenge: issued.challenge,
    origin: issued.origin,
    signer: 'passport',
    network: 'regtest'
  }, params), ACCOUNT.identity.key).uri;
}

function party (settings = {}) {
  return createPassportRelyingParty(Object.assign({
    pinnedOrigins: [SITE],
    network: 'regtest',
    production: false
  }, settings));
}

describe('passportRelyingParty', function () {
  it('refuses to start in production without pinned origins', function () {
    assert.throws(() => createPassportRelyingParty({ production: true }), /pinnedOrigins/);
    assert.throws(() => createPassportRelyingParty({ production: true, pinnedOrigins: ['not a url'] }), /pinnedOrigins/);
  });

  it('issues challenges only for pinned origins', async function () {
    const rp = party({ pinnedOrigins: [SITE, OTHER_SITE] });
    assert.strictEqual((await rp.issueChallenge({ origin: `${SITE}/path` })).origin, SITE);
    await assert.rejects(rp.issueChallenge({ origin: 'https://evil.example' }), /not pinned/);
    await assert.rejects(rp.issueChallenge({}), /not pinned/);
    const single = party();
    assert.strictEqual((await single.issueChallenge({})).origin, SITE);
  });

  it('allows loopback origins only when nothing is pinned outside production', async function () {
    const rp = createPassportRelyingParty({ production: false });
    assert.strictEqual((await rp.issueChallenge({ origin: 'http://127.0.0.1:8080' })).origin, 'http://127.0.0.1:8080');
    await assert.rejects(rp.issueChallenge({ origin: SITE }), /not pinned/);
  });

  it('redeems an assertion once, with its binding secret', async function () {
    const rp = party();
    const issued = await rp.issueChallenge({});
    const assertion = sign(issued);
    const verified = await rp.redeem(issued.bindingSecret, assertion);
    assert.strictEqual(verified.ok, true, verified.error);
    assert.strictEqual(verified.origin, SITE);
    assert.strictEqual(verified.identity.pubkey, ACCOUNT.identity.pubkey);
    const again = await rp.redeem(issued.bindingSecret, assertion);
    assert.strictEqual(again.ok, false);
  });

  it('refuses a stolen assertion without the binding secret', async function () {
    const rp = party();
    const issued = await rp.issueChallenge({});
    const assertion = sign(issued);
    const attacker = await rp.issueChallenge({});
    assert.strictEqual((await rp.redeem(attacker.bindingSecret, assertion)).ok, false);
    assert.strictEqual((await rp.redeem('', assertion)).ok, false);
    assert.strictEqual((await rp.redeem('ff'.repeat(32), assertion)).ok, false);
  });

  it('lets exactly one of two concurrent redeems through', async function () {
    const rp = party();
    const issued = await rp.issueChallenge({});
    const assertion = sign(issued);
    const results = await Promise.all([
      rp.redeem(issued.bindingSecret, assertion),
      rp.redeem(issued.bindingSecret, assertion)
    ]);
    assert.strictEqual(results.filter((r) => r.ok).length, 1);
  });

  it('spends the challenge even when the assertion fails', async function () {
    const rp = party();
    const issued = await rp.issueChallenge({});
    const wrong = await rp.issueChallenge({});
    assert.strictEqual((await rp.redeem(issued.bindingSecret, sign(wrong))).ok, false);
    assert.strictEqual((await rp.redeem(issued.bindingSecret, sign(issued))).ok, false);
  });

  it('accepts a wallet disclosure only when the challenge asked for it', async function () {
    const rp = party();
    const plain = await rp.issueChallenge({});
    assert.throws(() => sign(plain, { disclose: ['wallet'], wallet: ACCOUNT.wallet }), /did not ask for wallet/);
    const asked = await rp.issueChallenge({ request: ['wallet'] });
    const ok = await rp.redeem(asked.bindingSecret, sign(asked, { disclose: ['wallet'], wallet: ACCOUNT.wallet }));
    assert.strictEqual(ok.ok, true, ok.error);
    assert.strictEqual(ok.wallet.segwit.xpub.slice(0, 4), 'tpub');
  });

  it('keeps sessions under hashed tokens and revokes them', async function () {
    const sessionStore = createMemoryStore();
    const keys = [];
    const put = sessionStore.put;
    sessionStore.put = async (key, value) => {
      keys.push(key);
      return put(key, value);
    };
    const rp = party({ sessionStore });
    const issued = await rp.issueChallenge({});
    const verified = await rp.redeem(issued.bindingSecret, sign(issued));
    const { token, session } = await rp.issueSession(verified, { member: 'm1' });
    assert.deepStrictEqual(keys, [hashSecret(token)]);
    assert.strictEqual(session.member, 'm1');
    assert.strictEqual((await rp.readSession(token)).identityId, ACCOUNT.identity.id);
    assert.strictEqual(await rp.readSession(keys[0]), null);
    const view = rp.sessionView(session);
    assert.strictEqual(JSON.stringify(view).includes(token), false);
    await rp.revokeSession(token);
    assert.strictEqual(await rp.readSession(token), null);
  });

  it('expires sessions', async function () {
    let clock = Date.now();
    const rp = party({ now: () => clock, sessionTtlMs: 1000 });
    const issued = await rp.issueChallenge({});
    const verified = await rp.redeem(issued.bindingSecret, sign(issued, { now: clock }));
    const { token } = await rp.issueSession(verified);
    clock += 1001;
    assert.strictEqual(await rp.readSession(token), null);
  });
});
