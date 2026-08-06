'use strict';

const assert = require('assert');
const {
  parseFederationContractInvite,
  parseFederationContractInviteLoose,
  parseFederationContractInviteResponse,
  buildFederationContractInviteJson,
  buildFederationContractInviteResponseJson,
  normalizeSpendingTerms,
  formatFederationInviteSpendingSummary
} = require('../functions/federationContractInvite');

describe('federationContractInvite (@fabric/http)', function () {
  it('round-trips invite JSON', function () {
    const json = buildFederationContractInviteJson({
      inviteId: 'abc123',
      inviterHubId: 'deadbeef',
      contractId: 'c1',
      note: 'hello',
      invitedAt: 99
    });
    const p = parseFederationContractInvite(json);
    assert.strictEqual(p.inviteId, 'abc123');
    assert.strictEqual(p.inviterHubId, 'deadbeef');
    assert.strictEqual(p.contractId, 'c1');
    assert.strictEqual(p.note, 'hello');
    assert.strictEqual(p.invitedAt, 99);
    assert.strictEqual(p.v, 1);
  });

  it('round-trips extended invite with GoonCitizen labels', function () {
    const json = buildFederationContractInviteJson({
      inviteId: 'sess-1',
      inviterHubId: 'hubpk',
      note: 'join us',
      spendingTerms: { mode: 'percent', value: 25 },
      termsSummary: 'Treasury rules…',
      proposedPolicy: {
        validators: ['03' + 'a'.repeat(64), '02' + 'b'.repeat(64)],
        threshold: 2
      },
      publishSessionId: 'sess-1',
      inviteePubkey: '02' + 'c'.repeat(64),
      groupId: 'grp-1',
      groupName: 'Wing',
      role: 'reader',
      capabilityToken: 'payload.sig'
    });
    const p = parseFederationContractInvite(json);
    assert.strictEqual(p.v, 2);
    assert.deepStrictEqual(normalizeSpendingTerms(p.spendingTerms), { mode: 'percent', value: 25 });
    assert.strictEqual(formatFederationInviteSpendingSummary(p), 'Spending cap: 25% of treasury per agreement');
    assert.strictEqual(p.groupId, 'grp-1');
    assert.strictEqual(p.groupName, 'Wing');
    assert.strictEqual(p.role, 'reader');
    assert.strictEqual(p.capabilityToken, 'payload.sig');
    assert.ok(p.inviteePubkey);
    assert.strictEqual(parseFederationContractInviteLoose(p).inviteId, 'sess-1');
  });

  it('round-trips response JSON', function () {
    const json = buildFederationContractInviteResponseJson({
      inviteId: 'abc',
      accept: true,
      responderPubkey: '02aa',
      respondedAt: 1
    });
    const p = parseFederationContractInviteResponse(json);
    assert.strictEqual(p.inviteId, 'abc');
    assert.strictEqual(p.accept, true);
    assert.strictEqual(p.responderPubkey, '02aa');
    assert.strictEqual(p.respondedAt, 1);
  });

  it('rejects malformed payloads', function () {
    assert.strictEqual(parseFederationContractInvite('not json'), null);
    assert.strictEqual(parseFederationContractInvite('{}'), null);
    assert.strictEqual(parseFederationContractInvite('{"type":"FederationContractInvite","v":0,"inviteId":"x"}'), null);
    assert.strictEqual(parseFederationContractInviteResponse('{"type":"FederationContractInviteResponse","v":1}'), null);
  });
});
