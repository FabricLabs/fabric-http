'use strict';

const assert = require('assert');
const Message = require('@fabric/core/types/message');
const {
  messageBodyToJson,
  messageFromJsonBody,
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

  it('falls back to legacy JSON for GenericMessage', function () {
    const m = messageFromJsonBody('GenericMessage', { hello: true });
    const view = messageBodyToJson(m);
    assert.strictEqual(view.ok, true);
    assert.strictEqual(view.format, 'json');
    assert.deepStrictEqual(view.value, { hello: true });
  });

  it('RFC6902 sidechain JSON transforms to SIDECHAIN_STATE_PATCH fields', function () {
    const digest = 'ab'.repeat(32);
    const fields = rfc6902SidechainJsonToFields({
      basisClock: 2,
      basisDigest: digest,
      patches: [{ op: 'add', path: '/registry', value: { documents: { a: { rateSats: 1 } } } }]
    });
    assert.strictEqual(fields.basisClock, 2);
    assert.ok(Buffer.isBuffer(fields.basisDigest));
    assert.ok(fields.catalogCanonical.includes('"documents"'));
    const m = messageFromJsonBody('SIDECHAIN_STATE_PATCH', {
      basisClock: 2,
      basisDigest: digest,
      patches: [{ op: 'add', path: '/registry', value: { documents: { a: 1 } } }]
    });
    const view = messageBodyToJson(m);
    assert.strictEqual(view.format, 'fields');
    assert.ok(view.rfc6902 && Array.isArray(view.rfc6902.patches));
    const back = registryFieldsToRfc6902Json(view.value);
    assert.strictEqual(back.patches[0].path, '/registry');
  });
});
