'use strict';

/**
 * Issue a challenge, redeem the assertion once, and read the session view.
 * Run: node examples/passport-relying-party.js
 *
 * No listening socket. The relying party keeps the challenge in memory.
 */

const { generateMnemonic, importSeed, deriveAccount } = require('@fabric/core/functions/accountKeys');
const { signAssertion } = require('@fabric/core/functions/passport');
const { createPassportRelyingParty } = require('../functions/passportRelyingParty');

const ORIGIN = 'https://example.com';

function fail (message) {
  console.error('[EXAMPLES:PASSPORT_RP]', message);
  process.exitCode = 1;
  throw new Error(message);
}

async function main () {
  const party = createPassportRelyingParty({
    pinnedOrigins: [ORIGIN],
    network: 'regtest',
    production: false
  });
  const account = deriveAccount(importSeed(generateMnemonic()), { account: 0, network: 'regtest' });
  const issued = await party.issueChallenge({ origin: ORIGIN });
  const assertion = signAssertion({
    challenge: issued.challenge,
    origin: ORIGIN,
    signer: 'passport',
    network: 'regtest'
  }, account.identity.key);

  const redeemed = await party.redeem(issued.bindingSecret, assertion.uri);
  if (!redeemed.ok) fail(redeemed.error);
  if (redeemed.identity.pubkey !== account.identity.pubkey) fail('session identity is not the signer');

  const started = await party.issueSession(redeemed);
  const view = party.sessionView(await party.readSession(started.token));
  if (!view || view.identity.pubkey !== account.identity.pubkey) fail('session view dropped the pubkey');
  if (view.token) fail('the public view should not carry the session token');

  const again = await party.redeem(issued.bindingSecret, assertion.uri);
  if (again.ok) fail('a challenge should redeem only once');

  console.log('[EXAMPLES:PASSPORT_RP]', 'origin', view.origin);
  console.log('[EXAMPLES:PASSPORT_RP]', 'identity', view.identity.id);
  console.log('[EXAMPLES:PASSPORT_RP]', 'second redeem', again.error);
}

main().catch((error) => {
  console.error('[EXAMPLES:PASSPORT_RP]', error.message || error);
  process.exitCode = 1;
});
