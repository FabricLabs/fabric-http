'use strict';

const assert = require('assert');
const { verifyBearerToken, buildBearerToken } = require('../middlewares/auth');

describe('middlewares/auth — buildBearerToken / verifyBearerToken', function () {
  it('produces a token that verifyBearerToken accepts', function () {
    const secret = 'unit-test-bearer-secret';
    const token = buildBearerToken(secret, { sub: 'u1', role: 'admin' });
    const v = verifyBearerToken(token, secret);
    assert.strictEqual(v.valid, true);
    assert.deepStrictEqual(v.payload, { sub: 'u1', role: 'admin' });
  });

  it('rejects when secret differs', function () {
    const token = buildBearerToken('a', { x: 1 });
    const v = verifyBearerToken(token, 'b');
    assert.strictEqual(v.valid, false);
  });

  it('rejects array payloads (non–plain object)', function () {
    assert.throws(function () {
      buildBearerToken('a', [1, 2]);
    }, /plain object/);
  });
});
