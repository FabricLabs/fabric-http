'use strict';

const assert = require('assert');
const Key = require('@fabric/core/types/key');
const {
  ATTESTATION_TYPE,
  KIND_PEERING,
  buildOracleAttestation,
  verifyOracleAttestation,
  stableStringify
} = require('../functions/oracleAttestation');

describe('@fabric/http oracleAttestation', function () {
  it('stableStringify sorts object keys', function () {
    assert.strictEqual(stableStringify({ b: 1, a: 2 }), '{"a":2,"b":1}');
  });

  it('signs and verifies a peering claim', function () {
    const key = new Key();
    const claim = { kind: KIND_PEERING, version: 1, fabricPeerId: key.pubkey };
    const att = buildOracleAttestation({
      claim,
      key,
      issuer: { publicKeyHex: key.pubkey, fabricIdentityId: key.pubkey }
    });
    assert.strictEqual(att['@type'], ATTESTATION_TYPE);
    assert.strictEqual(att.kind, KIND_PEERING);
    assert.ok(att.signature);
    assert.strictEqual(verifyOracleAttestation(att), true);
  });

  it('rejects tampered claims', function () {
    const key = new Key();
    const att = buildOracleAttestation({
      claim: { kind: KIND_PEERING, version: 1, n: 1 },
      key
    });
    att.claim.n = 2;
    assert.strictEqual(verifyOracleAttestation(att), false);
  });
});
