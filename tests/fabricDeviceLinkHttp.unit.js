'use strict';

const assert = require('assert');
const Key = require('@fabric/core/types/key');
const Identity = require('@fabric/core/types/identity');
const {
  identityFromXpub
} = require('../functions/fabricDeviceLinkHttp');

describe('fabricDeviceLinkHttp identityFromXpub', function () {
  it('resolves Key + Identity id from a valid xpub (regression: missing requires)', function () {
    const seed = new Key();
    const watch = new Key({ xpub: seed.xpub });
    const resolved = identityFromXpub(seed.xpub);
    assert.ok(resolved.key);
    assert.strictEqual(String(resolved.pubkeyHex).toLowerCase(), String(watch.pubkey).toLowerCase());
    const expectedId = String(new Identity(watch).id);
    assert.strictEqual(resolved.id, expectedId);
    assert.ok(/^id1/.test(resolved.id));
  });

  it('throws on invalid xpub', function () {
    assert.throws(() => identityFromXpub('not-an-xpub'), Error);
  });
});
