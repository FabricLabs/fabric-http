'use strict';

/**
 * A grant frame in a JSON body, and a rate limit that stops the next call.
 * Run: node examples/delegation-body.js
 *
 * No socket. readFrame accepts the body object Express would already have parsed.
 */

const { generateMnemonic, importSeed, deriveAccount } = require('@fabric/core/functions/accountKeys');
const { createGrant } = require('@fabric/core/functions/delegation');
const { readFrame, createRateLimit } = require('../functions/delegationHttpBody');

function fail (message) {
  console.error('[EXAMPLES:DELEGATION_BODY]', message);
  process.exitCode = 1;
  throw new Error(message);
}

async function main () {
  const master = importSeed(generateMnemonic());
  const alice = deriveAccount(master, { account: 0, network: 'regtest' });
  const hub = deriveAccount(master, { account: 1, network: 'regtest' });
  const grant = createGrant({
    grantee: alice.identity.pubkey,
    scopes: ['message'],
    label: 'Hub'
  }, hub.identity.key);

  const read = await readFrame({ body: { fabric: grant.uri } });
  if (read.frame !== grant.uri) fail('the fabric field should be the grant URI');

  const bare = await readFrame({ body: grant.uri });
  if (bare.frame !== grant.uri) fail('a bare fabric: string should be accepted');

  const take = createRateLimit({ limit: 1, windowMs: 60000, now: () => 1 });
  if (take('203.0.113.4') !== true) fail('the first call should be allowed');
  if (take('203.0.113.4') !== false) fail('the next call in the window should be refused');
  if (take('203.0.113.5') !== true) fail('a different address should have its own window');

  console.log('[EXAMPLES:DELEGATION_BODY]', 'frame', read.frame.slice(0, 20) + '…');
  console.log('[EXAMPLES:DELEGATION_BODY]', 'rate limit stops the second call');
}

main().catch((error) => {
  console.error('[EXAMPLES:DELEGATION_BODY]', error.message || error);
  process.exitCode = 1;
});
