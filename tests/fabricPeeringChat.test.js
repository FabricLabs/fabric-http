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

  it('copies optional Hub-cache fields and omits them when absent', function () {
    const n = normalizeP2pChatMessage({
      text: 'hello',
      actor: { publicKey: 'aa', pubkey: 'bb' },
      object: { clientId: 7, id: 'm1' },
      target: 'peer-1',
      created: 123
    });
    assert.strictEqual(n.object.created, 123);
    assert.strictEqual(n.object.clientId, '7');
    assert.strictEqual(n.object.id, 'm1');
    assert.strictEqual(n.actor.publicKey, 'aa');
    assert.strictEqual(n.actor.pubkey, 'bb');
    assert.strictEqual(n.target, 'peer-1');

    const bare = normalizeP2pChatMessage({ text: 'hello' });
    assert.ok(!Object.prototype.hasOwnProperty.call(bare.object, 'clientId'));
    assert.ok(!Object.prototype.hasOwnProperty.call(bare.object, 'id'));
    assert.ok(!Object.prototype.hasOwnProperty.call(bare.actor, 'publicKey'));
    assert.ok(!Object.prototype.hasOwnProperty.call(bare, 'target'));
    assert.strictEqual(typeof bare.object.created, 'number');
  });

  it('never emits a non-positive created (epoch 0 breaks chat sort order)', function () {
    // `Number(null)` and `Number('')` are 0, which is finite. Gating the
    // fallbacks on `isFinite` alone accepted epoch 0 and, worse, skipped the
    // `ts` fallback entirely — stamping 1970 onto messages carrying a good
    // timestamp. Hub used to patch this downstream; it belongs here.
    const before = Date.now();
    for (const created of [null, '', 0, -5, NaN, 'nope', undefined]) {
      const out = normalizeP2pChatMessage({ object: { content: 'hi', created } });
      assert.ok(out.object.created > 0, `created=${String(created)} produced ${out.object.created}`);
      assert.ok(out.object.created >= before, `created=${String(created)} should fall back to now()`);
    }
  });

  it('falls back to object.ts when created is missing or non-positive', function () {
    const ts = '2026-08-24T00:00:00.000Z';
    for (const created of [null, '', 0, undefined]) {
      const out = normalizeP2pChatMessage({ object: { content: 'hi', created, ts } });
      assert.strictEqual(out.object.created, Date.parse(ts), `created=${String(created)}`);
    }
    // An unparseable `ts` still yields now(), not NaN or 0.
    const bad = normalizeP2pChatMessage({ object: { content: 'hi', created: null, ts: 'not-a-date' } });
    assert.ok(bad.object.created > 0);
  });

  it('honours a positive created and the outer chat.created fallback', function () {
    const exact = normalizeP2pChatMessage({ object: { content: 'hi', created: 1700000000000 } });
    assert.strictEqual(exact.object.created, 1700000000000);
    const outer = normalizeP2pChatMessage({ created: 1600000000000, object: { content: 'hi', created: null } });
    assert.strictEqual(outer.object.created, 1600000000000);
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
