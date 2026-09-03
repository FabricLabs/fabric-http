'use strict';

/**
 * HTTP-edge helpers used when playnet contracts invite co-signers after publish.
 * Complements Hub/application publish + re-publish flows.
 */

const assert = require('assert');
const {
  buildFederationContractInviteJson,
  parseFederationContractInvite,
  buildFederationContractInviteResponseJson,
  parseFederationContractInviteResponse,
  normalizeProposedPolicy,
  normalizeSpendingTerms
} = require('../functions/federationContractInvite');

describe('playnet federation wallet invite (post-publish)', function () {
  const alice = '02' + '11'.repeat(32);
  const bob = '03' + '22'.repeat(32);

  it('builds a v2 multisig invite bound to a published contract id', function () {
    const contractId = 'ab'.repeat(32);
    const json = buildFederationContractInviteJson({
      inviteId: 'playnet-inv-1',
      inviterHubId: alice,
      contractId,
      note: 'playnet treasury',
      groupName: 'Playnet wallet',
      spendingTerms: { mode: 'percent', value: 10 },
      proposedPolicy: { validators: [alice, bob], threshold: 2 },
      termsSummary: 'regtest leader settlement'
    });
    const parsed = parseFederationContractInvite(json);
    assert.ok(parsed);
    assert.strictEqual(parsed.v, 2);
    assert.strictEqual(parsed.contractId, contractId);
    assert.strictEqual(parsed.groupName, 'Playnet wallet');
    assert.deepStrictEqual(normalizeSpendingTerms(parsed.spendingTerms), { mode: 'percent', value: 10 });
    const policy = normalizeProposedPolicy(parsed.proposedPolicy);
    assert.ok(policy);
    assert.strictEqual(policy.threshold, 2);
    assert.strictEqual(policy.validators.length, 2);
  });

  it('round-trips accept response for re-publish / join after scan', function () {
    const json = buildFederationContractInviteResponseJson({
      inviteId: 'playnet-inv-1',
      accept: true,
      responderPubkey: bob,
      respondedAt: 42
    });
    const p = parseFederationContractInviteResponse(json);
    assert.strictEqual(p.accept, true);
    assert.strictEqual(p.responderPubkey, bob);
    assert.strictEqual(p.inviteId, 'playnet-inv-1');
  });
});
