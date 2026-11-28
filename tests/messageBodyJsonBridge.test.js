'use strict';

const assert = require('assert');
const Message = require('@fabric/core/types/message');
const {
  messageBodyToJson,
  messageFromJsonBody,
  messageFromLegacyJson,
  legacyBodyOf,
  rfc6902SidechainJsonToFields,
  registryFieldsToRfc6902Json
} = require('../functions/messageBodyJsonBridge');

describe('@fabric/http messageBodyJsonBridge', function () {
  it('maps field-body Ping to JSON via messageBodyToJson', function () {
    const m = Message.fromFields('P2P_PING', { nonce: '99' });
    const view = messageBodyToJson(m);
    assert.strictEqual(view.ok, true);
    assert.strictEqual(view.format, 'fields');
    assert.deepStrictEqual(view.value, { nonce: '99' });
  });

  it('messageFromJsonBody uses fromFields when schema exists', function () {
    const m = messageFromJsonBody('P2P_PING', { nonce: '7' });
    assert.strictEqual(m.type, 'P2P_PING');
    assert.deepStrictEqual(m.toFields(), { nonce: '7' });
  });

  it('messageFromLegacyJson field-encodes CONTRACT_MESSAGE and reads it back', function () {
    const body = { contract: 'ab'.repeat(32), type: 'Example', object: { n: 1 } };
    const m = messageFromLegacyJson('CONTRACT_MESSAGE', body);
    assert.strictEqual(m.type, 'CONTRACT_MESSAGE');
    const view = messageBodyToJson(m);
    assert.strictEqual(view.format, 'fields');
    assert.deepStrictEqual(view.legacy, body);
  });

  it('legacyBodyOf reads JSON-encoded CONTRACT_MESSAGE the same way', function () {
    const body = { contract: 'cd'.repeat(32), type: 'Example', object: { n: 2 } };
    const m = Message.fromVector(['CONTRACT_MESSAGE', JSON.stringify(body)]);
    assert.deepStrictEqual(legacyBodyOf(m), body);
    assert.deepStrictEqual(messageBodyToJson(m).legacy, body);
  });

  it('reads a plain { type, data } record holding a JSON CONTRACT_MESSAGE', function () {
    const body = { contract: 'ef'.repeat(32), type: 'Example', object: { n: 3 } };
    const view = messageBodyToJson({ type: 'CONTRACT_MESSAGE', data: JSON.stringify(body) });
    assert.strictEqual(view.ok, true, view.error);
    assert.strictEqual(view.format, 'json');
    assert.deepStrictEqual(view.value, body);
    assert.deepStrictEqual(view.legacy, body);
  });

  it('messageFromLegacyJson keeps keyed-layout keys (DOCUMENT_REQUEST)', function () {
    const body = { id: 'doc1', maxSats: 500, blobIndex: 0, reason: 'x' };
    const m = messageFromLegacyJson('DOCUMENT_REQUEST', body);
    assert.deepStrictEqual(legacyBodyOf(m), body);
  });

  it('messageFromLegacyJson falls back for unmapped types', function () {
    const m = messageFromLegacyJson('GenericMessage', { hello: true });
    assert.strictEqual(legacyBodyOf(m), null);
    assert.deepStrictEqual(messageBodyToJson(m).value, { hello: true });
  });

  it('falls back to legacy JSON for GenericMessage', function () {
    const m = messageFromJsonBody('GenericMessage', { hello: true });
    const view = messageBodyToJson(m);
    assert.strictEqual(view.ok, true);
    assert.strictEqual(view.format, 'json');
    assert.deepStrictEqual(view.value, { hello: true });
  });

  it('RFC6902 sidechain JSON transforms to SIDECHAIN_STATE_PATCH fields', function () {
    const digest = 'ab'.repeat(32);
    const registryValue = { documents: { a: { rateSats: 1 } } };
    const fields = rfc6902SidechainJsonToFields({
      basisClock: 2,
      basisDigest: digest,
      patches: [{ op: 'add', path: '/registry', value: registryValue }]
    });
    assert.strictEqual(fields.basisClock, 2);
    assert.ok(Buffer.isBuffer(fields.basisDigest));
    assert.strictEqual(fields.basisDigest.toString('hex'), digest);
    assert.ok(fields.catalogCanonical.includes('"documents"'));
    assert.ok(fields.patchesCanonical.includes('/registry'));
    const m = messageFromJsonBody('SIDECHAIN_STATE_PATCH', {
      basisClock: 2,
      basisDigest: digest,
      patches: [{ op: 'add', path: '/registry', value: registryValue }]
    });
    const view = messageBodyToJson(m);
    assert.strictEqual(view.format, 'fields');
    assert.ok(view.rfc6902 && Array.isArray(view.rfc6902.patches));
    assert.strictEqual(view.value.basisDigest, digest);
    const back = registryFieldsToRfc6902Json(view.value);
    assert.strictEqual(back.patches[0].path, '/registry');
    assert.deepStrictEqual(back.patches[0].value, { documents: { a: { rateSats: 1 } } });
  });

  it('preserves multi-op RFC6902 sequences via patchesCanonical', function () {
    const digest = 'cd'.repeat(32);
    const patches = [
      { op: 'add', path: '/registry', value: { documents: { a: 1 } } },
      { op: 'add', path: '/meta/label', value: 'fleet' },
      { op: 'replace', path: '/meta/label', value: 'wing' }
    ];
    const fields = rfc6902SidechainJsonToFields({
      basisClock: 1,
      basisDigest: digest,
      patches
    });
    assert.deepStrictEqual(JSON.parse(fields.patchesCanonical), patches);
    assert.deepStrictEqual(JSON.parse(fields.catalogCanonical), { documents: { a: 1 } });

    const m = messageFromJsonBody('SIDECHAIN_STATE_PATCH', {
      basisClock: 1,
      basisDigest: digest,
      patches
    });
    const view = messageBodyToJson(m);
    assert.deepStrictEqual(view.rfc6902.patches, patches);
  });

  it('rejects invalid RFC6902 patch ops at the HTTP edge', function () {
    assert.throws(() => rfc6902SidechainJsonToFields({
      patches: [{ op: 'nope', path: '/x' }]
    }), /RFC6902/);
  });

  it('sidechain patch frames round-trip vector parent through AMP wire', function () {
    const Key = require('@fabric/core/types/key');
    const { frameIdOf } = Message;
    const key = new Key();
    const digest = 'ef'.repeat(32);
    const genesis = messageFromJsonBody('SIDECHAIN_STATE_PATCH', {
      basisClock: 0,
      basisDigest: '00'.repeat(32),
      patches: [{ op: 'add', path: '/registry', value: { v: 1 } }]
    }).signWithKey(key);

    const patches = [{ op: 'replace', path: '/registry/v', value: 2 }];
    const child = messageFromJsonBody('SIDECHAIN_STATE_PATCH', {
      basisClock: 1,
      basisDigest: digest,
      patches
    });
    child.parent = genesis.id;
    child.signWithKey(key);

    const vec = child.toVector();
    assert.strictEqual(vec.length, 3);
    assert.strictEqual(vec[2], genesis.id);

    const restored = Message.fromVector(vec);
    assert.strictEqual(restored.parent, genesis.id);
    assert.strictEqual(String(restored.data), String(child.data));

    const wire = Message.fromBuffer(child.toBuffer());
    assert.strictEqual(wire.parent, genesis.id);
    assert.strictEqual(frameIdOf(wire), frameIdOf(child));
    const view = messageBodyToJson(wire);
    assert.strictEqual(view.format, 'fields');
    assert.deepStrictEqual(view.rfc6902.patches, patches);
  });

  it('parent vectors round-trip through Message.fromVector', function () {
    const Key = require('@fabric/core/types/key');
    const key = new Key();
    const genesis = Message.fromVector(['P2P_CHAT_MESSAGE', 'hub-genesis']).signWithKey(key);
    const child = Message.fromVector(['P2P_CHAT_MESSAGE', 'hub-child', genesis]).signWithKey(key);
    const vec = child.toVector();
    assert.strictEqual(vec.length, 3);
    assert.strictEqual(Message.fromVector(vec).parent, genesis.id);
  });

  it('first-class AMP inventory frames keep the wire name when JSON type is 98', function () {
    const wire = Message.fromVector(['P2P_INVENTORY_RESPONSE', JSON.stringify({
      type: 98,
      host: '203.0.113.99',
      port: 7777
    })]);
    assert.strictEqual(wire.type, 'P2P_INVENTORY_RESPONSE');
    assert.notStrictEqual(wire.type, 'P2P_PEERING_OFFER');
    assert.strictEqual(JSON.parse(String(wire.body)).type, 98);
  });
});
