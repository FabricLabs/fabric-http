'use strict';

const assert = require('assert');
const {
  parseFederationContractInvite,
  parseFederationContractInviteLoose,
  parseFederationContractInviteResponse,
  parseFederationContractInviteResponseLoose,
  buildFederationContractInviteJson,
  buildFederationContractInviteResponseJson,
  normalizeSpendingTerms,
  normalizeProposedPolicy,
  formatFederationInviteSpendingSummary,
  DEFAULT_FEDERATION_INVITE_TTL_MS,
  positiveEpochMs,
  normalizeInviteExpiresAtMs,
  federationInviteIsExpired
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
    assert.strictEqual(p.expiresAt, 99 + DEFAULT_FEDERATION_INVITE_TTL_MS);
    assert.strictEqual(p.v, 1);
  });

  it('defaults expiresAt to 7 days after invitedAt and honours an explicit value', function () {
    const json = buildFederationContractInviteJson({
      inviteId: 'exp-1',
      inviterHubId: 'deadbeef',
      invitedAt: 1_700_000_000_000
    });
    const p = parseFederationContractInvite(json);
    assert.strictEqual(p.expiresAt, 1_700_000_000_000 + DEFAULT_FEDERATION_INVITE_TTL_MS);
    assert.strictEqual(federationInviteIsExpired(p, 1_700_000_000_000 + DEFAULT_FEDERATION_INVITE_TTL_MS), false);
    assert.strictEqual(federationInviteIsExpired(p, 1_700_000_000_000 + DEFAULT_FEDERATION_INVITE_TTL_MS + 1), true);

    const custom = parseFederationContractInvite(buildFederationContractInviteJson({
      inviteId: 'exp-2',
      inviterHubId: 'deadbeef',
      invitedAt: 1_700_000_000_000,
      expiresAt: 1_700_000_000_000 + 3600000
    }));
    assert.strictEqual(custom.expiresAt, 1_700_000_000_000 + 3600000);

    const ttl = parseFederationContractInvite(buildFederationContractInviteJson({
      inviteId: 'exp-3',
      inviterHubId: 'deadbeef',
      invitedAt: 50,
      ttlMs: 10
    }));
    assert.strictEqual(ttl.expiresAt, 60);
    assert.strictEqual(federationInviteIsExpired({ type: 'FederationContractInvite', inviteId: 'legacy' }), false);
  });

  it('rejects non-positive invitedAt and expiresAt timestamps', function () {
    assert.strictEqual(positiveEpochMs(null), null);
    assert.strictEqual(positiveEpochMs(0), null);
    assert.strictEqual(positiveEpochMs(-1), null);
    assert.strictEqual(positiveEpochMs(''), null);
    assert.strictEqual(positiveEpochMs(42), 42);
    assert.strictEqual(normalizeInviteExpiresAtMs(0), null);
    assert.strictEqual(normalizeInviteExpiresAtMs(-5), null);

    const before = Date.now();
    const zeroInvited = parseFederationContractInvite(buildFederationContractInviteJson({
      inviteId: 'zero-invited',
      inviterHubId: 'deadbeef',
      invitedAt: 0
    }));
    const after = Date.now();
    assert.ok(zeroInvited.invitedAt >= before && zeroInvited.invitedAt <= after);
    assert.strictEqual(zeroInvited.expiresAt, zeroInvited.invitedAt + DEFAULT_FEDERATION_INVITE_TTL_MS);
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

  it('never stamps non-positive respondedAt on invite responses', function () {
    const before = Date.now();
    const p = parseFederationContractInviteResponse(
      buildFederationContractInviteResponseJson({
        inviteId: 'resp-zero',
        accept: false,
        respondedAt: 0
      })
    );
    const after = Date.now();
    assert.ok(p.respondedAt >= before && p.respondedAt <= after);
    assert.strictEqual(p.accept, false);
  });

  it('rejects malformed payloads', function () {
    assert.strictEqual(parseFederationContractInvite('not json'), null);
    assert.strictEqual(parseFederationContractInvite('{}'), null);
    assert.strictEqual(parseFederationContractInvite('{"type":"FederationContractInvite","v":0,"inviteId":"x"}'), null);
    assert.strictEqual(parseFederationContractInviteResponse('{"type":"FederationContractInviteResponse","v":1}'), null);
    assert.strictEqual(parseFederationContractInviteResponse(
      '{"type":"FederationContractInviteResponse","v":1,"inviteId":"x","accept":"false"}'
    ), null);
    assert.strictEqual(parseFederationContractInviteResponseLoose({
      type: 'FederationContractInviteResponse',
      v: 1,
      inviteId: 'x',
      accept: 1
    }), null);
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

    const badExpiry = JSON.stringify({
      type: 'FederationContractInvite',
      v: 1,
      inviteId: 'x',
      expiresAt: 'not-a-date'
    });
    assert.strictEqual(parseFederationContractInvite(badExpiry), null);
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
