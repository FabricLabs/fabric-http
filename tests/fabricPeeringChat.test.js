'use strict';

const assert = require('assert');
const Key = require('@fabric/core/types/key');
const {
  pubkeyXOnly,
  pubkeysMatch,
  canonicalChatAuthor
} = require('../functions/fabricPubkey');
const {
  chatTextOf,
  chatActorIdOf,
  normalizeP2pChatMessage
} = require('../functions/fabricChatNormalize');
const {
  PEERING_BASE,
  buildPeeringCapabilitiesBody,
  isPeeringHttpPath,
  tryHandlePeeringHttp
} = require('../functions/fabricPeeringHttp');
const { buildOracleAttestation } = require('../functions/oracleAttestation');

describe('@fabric/http fabricPubkey', function () {
  it('matches compressed and x-only forms', function () {
    const key = new Key();
    const x = pubkeyXOnly(key.pubkey);
    assert.ok(x);
    assert.strictEqual(x.length, 64);
    assert.strictEqual(pubkeysMatch(key.pubkey, x), true);
    assert.strictEqual(canonicalChatAuthor(key.pubkey), x);
  });
});

describe('@fabric/http fabricChatNormalize', function () {
  it('re-exports core fabricChatText leaves', function () {
    const core = require('@fabric/core/functions/fabricChatText');
    const httpChat = require('../functions/fabricChatNormalize');
    assert.strictEqual(httpChat.chatTextOf, core.chatTextOf);
    assert.strictEqual(httpChat.chatActorIdOf, core.chatActorIdOf);
  });

  it('prefers mesh text and canonicalizes actor when pubkey-like', function () {
    const key = new Key();
    const x = pubkeyXOnly(key.pubkey);
    assert.strictEqual(chatTextOf({ text: 'hello mesh' }), 'hello mesh');
    const n = normalizeP2pChatMessage({ text: 'hello mesh' }, { signer: key.pubkey });
    assert.strictEqual(n.object.content, 'hello mesh');
    assert.strictEqual(n.actor.id, x);
    assert.strictEqual(chatActorIdOf({}, { signer: 'bb' }), 'bb');
  });
});

describe('@fabric/http fabricPeeringHttp', function () {
  it('builds capabilities envelope', function () {
    const body = buildPeeringCapabilitiesBody({
      claim: { kind: 'PeeringCapability', version: 1 },
      oracleAttestation: { '@type': 'OracleAttestation' }
    });
    assert.strictEqual(body.service, 'peering');
    assert.strictEqual(body.endpointBasePath, PEERING_BASE);
    assert.ok(body.claim);
    assert.ok(body.attestationUrl);
  });

  it('tryHandlePeeringHttp serves GET /services/peering', function (done) {
    const key = new Key();
    const claim = { kind: 'PeeringCapability', version: 1, fabricPeerId: key.pubkey };
    const att = buildOracleAttestation({ claim, key });
    const caps = buildPeeringCapabilitiesBody({ claim, oracleAttestation: att });
    const chunks = [];
    const res = {
      writeHead (code, headers) {
        this.statusCode = code;
        this.headers = headers;
      },
      end (buf) {
        if (buf) chunks.push(buf);
        assert.strictEqual(this.statusCode, 200);
        const body = JSON.parse(chunks.join(''));
        assert.strictEqual(body.service, 'peering');
        assert.strictEqual(body.oracleAttestation.signature, att.signature);
        done();
      }
    };
    const handled = tryHandlePeeringHttp(
      { method: 'GET' },
      res,
      PEERING_BASE,
      { getCapabilities: () => caps }
    );
    assert.strictEqual(handled, true);
  });

  it('isPeeringHttpPath matches discovery routes', function () {
    assert.strictEqual(isPeeringHttpPath('/', 'OPTIONS'), true);
    assert.strictEqual(isPeeringHttpPath(PEERING_BASE, 'GET'), true);
    assert.strictEqual(isPeeringHttpPath(`${PEERING_BASE}/attestation`, 'GET'), true);
    assert.strictEqual(isPeeringHttpPath('/other', 'GET'), false);
  });
});
