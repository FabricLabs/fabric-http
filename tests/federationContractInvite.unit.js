'use strict';

const assert = require('assert');
const {
  parseFederationContractInvite,
  parseFederationContractInviteLoose,
  parseFederationContractInviteResponse,
  buildFederationContractInviteJson,
  buildFederationContractInviteResponseJson,
  normalizeSpendingTerms,
  normalizeProposedPolicy,
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

  it('round-trips extended invite with app group labels', function () {
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

  it('normalizeProposedPolicy rejects duplicates and non-integer thresholds', function () {
    assert.strictEqual(normalizeProposedPolicy({
      validators: ['aa', 'aa'],
      threshold: 1
    }), null);
    assert.strictEqual(normalizeProposedPolicy({
      validators: ['AA', 'aa'],
      threshold: 1
    }), null);
    assert.strictEqual(normalizeProposedPolicy({
      validators: ['aa', 'bb'],
      threshold: 1.5
    }), null);
    assert.strictEqual(normalizeProposedPolicy({
      validators: ['aa', 'bb'],
      threshold: 3
    }), null);
    assert.strictEqual(normalizeProposedPolicy({
      validators: ['aa', 'bb'],
      threshold: 0
    }), null);
    assert.deepStrictEqual(normalizeProposedPolicy({
      validators: ['aa', 'bb'],
      threshold: 2
    }), { validators: ['aa', 'bb'], threshold: 2 });
  });

  it('parse rejects invalid spendingTerms / proposedPolicy when present', function () {
    const badSpend = JSON.stringify({
      type: 'FederationContractInvite',
      v: 2,
      inviteId: 'x',
      spendingTerms: { mode: 'percent', value: 150 }
    });
    assert.strictEqual(parseFederationContractInvite(badSpend), null);
    assert.strictEqual(parseFederationContractInviteLoose(JSON.parse(badSpend)), null);

    const badPolicy = JSON.stringify({
      type: 'FederationContractInvite',
      v: 2,
      inviteId: 'x',
      proposedPolicy: { validators: ['a', 'a'], threshold: 1 }
    });
    assert.strictEqual(parseFederationContractInvite(badPolicy), null);
    assert.strictEqual(parseFederationContractInviteLoose(JSON.parse(badPolicy)), null);
  });

  it('buildFederationContractInviteResponseJson requires boolean accept', function () {
    assert.throws(() => buildFederationContractInviteResponseJson({
      inviteId: 'x',
      accept: 'false'
    }), TypeError);
    assert.throws(() => buildFederationContractInviteResponseJson({
      inviteId: 'x',
      accept: 1
    }), TypeError);
    assert.throws(() => buildFederationContractInviteResponseJson({
      inviteId: 'x',
      accept: null
    }), TypeError);
    const ok = JSON.parse(buildFederationContractInviteResponseJson({
      inviteId: 'x',
      accept: false
    }));
    assert.strictEqual(ok.accept, false);
  });
});
