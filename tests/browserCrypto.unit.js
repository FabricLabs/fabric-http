'use strict';

const assert = require('assert');
const nodeCrypto = require('crypto');
const browserCrypto = require('../functions/browserCrypto');

const KEY = Buffer.from('000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f', 'hex');
const IV16 = Buffer.from('a0a1a2a3a4a5a6a7a8a9aaabacadaeaf', 'hex');
const IV12 = IV16.subarray(0, 12);
const PLAINTEXT = Buffer.from('Fabric browser crypto, matched byte for byte against Node. '.repeat(3));

function run (lib, mode, decrypt, key, iv, input, setup = () => {}) {
  const c = decrypt ? lib.createDecipheriv(mode, key, iv) : lib.createCipheriv(mode, key, iv);
  setup(c);
  return Buffer.concat([c.update(input), c.final()]);
}

describe('functions/browserCrypto', function () {
  describe('hashes and HMAC', function () {
    for (const algorithm of ['sha1', 'sha224', 'sha256', 'sha384', 'sha512', 'ripemd160']) {
      it(`createHash('${algorithm}') matches Node`, function () {
        const expected = nodeCrypto.createHash(algorithm).update('abc').update(PLAINTEXT).digest('hex');
        const actual = browserCrypto.createHash(algorithm).update('abc').update(PLAINTEXT).digest('hex');
        assert.strictEqual(actual, expected);
      });

      it(`createHmac('${algorithm}') matches Node`, function () {
        const expected = nodeCrypto.createHmac(algorithm, KEY).update(PLAINTEXT).digest();
        const actual = browserCrypto.createHmac(algorithm, KEY).update(PLAINTEXT).digest();
        assert.ok(Buffer.isBuffer(actual));
        assert.ok(actual.equals(expected));
      });
    }

    it('accepts hyphenated and uppercase names, string keys, and encodings', function () {
      assert.strictEqual(
        browserCrypto.createHash('SHA-256').update('ff00', 'hex').digest('base64'),
        nodeCrypto.createHash('sha256').update('ff00', 'hex').digest('base64')
      );
      assert.strictEqual(
        browserCrypto.createHmac('sha256', 'secret').update('message').digest('hex'),
        nodeCrypto.createHmac('sha256', 'secret').update('message').digest('hex')
      );
    });

    it('digests an empty hash to the algorithm length (HKDF sizing)', function () {
      assert.strictEqual(browserCrypto.createHash('sha256').digest().length, 32);
    });

    it('copies hash state', function () {
      const base = browserCrypto.createHash('sha256').update('a');
      const fork = base.copy().update('b');
      assert.strictEqual(base.digest('hex'), nodeCrypto.createHash('sha256').update('a').digest('hex'));
      assert.strictEqual(fork.digest('hex'), nodeCrypto.createHash('sha256').update('ab').digest('hex'));
    });

    it('rejects unknown digests', function () {
      assert.throws(() => browserCrypto.createHash('md5'), /Digest method not supported/);
    });
  });

  describe('key derivation', function () {
    it('pbkdf2Sync matches Node', function () {
      const expected = nodeCrypto.pbkdf2Sync('password', 'salt', 1000, 32, 'sha256');
      assert.ok(browserCrypto.pbkdf2Sync('password', 'salt', 1000, 32, 'sha256').equals(expected));
      const sha512 = nodeCrypto.pbkdf2Sync('mnemonic words', 'mnemonic', 2048, 64, 'sha512');
      assert.ok(browserCrypto.pbkdf2Sync('mnemonic words', 'mnemonic', 2048, 64, 'sha512').equals(sha512));
    });

    it('hkdfSync matches Node and returns an ArrayBuffer', function () {
      const expected = nodeCrypto.hkdfSync('sha256', KEY, 'salt', 'info', 48);
      const actual = browserCrypto.hkdfSync('sha256', KEY, 'salt', 'info', 48);
      assert.ok(actual instanceof ArrayBuffer);
      assert.ok(Buffer.from(actual).equals(Buffer.from(expected)));
    });
  });

  describe('ciphers', function () {
    for (const mode of ['aes-256-cbc', 'aes-256-ctr', 'aes-128-cbc']) {
      it(`${mode} encrypts like Node and both decrypt each other`, function () {
        const key = mode.startsWith('aes-128') ? KEY.subarray(0, 16) : KEY;
        const expected = run(nodeCrypto, mode, false, key, IV16, PLAINTEXT);
        const actual = run(browserCrypto, mode, false, key, IV16, PLAINTEXT);
        assert.ok(actual.equals(expected));
        assert.ok(run(browserCrypto, mode, true, key, IV16, expected).equals(PLAINTEXT));
        assert.ok(run(nodeCrypto, mode, true, key, IV16, actual).equals(PLAINTEXT));
      });
    }

    it('aes-256-cbc honours setAutoPadding(false)', function () {
      const block = PLAINTEXT.subarray(0, 64);
      const off = (c) => c.setAutoPadding(false);
      const expected = run(nodeCrypto, 'aes-256-cbc', false, KEY, IV16, block, off);
      assert.ok(run(browserCrypto, 'aes-256-cbc', false, KEY, IV16, block, off).equals(expected));
      assert.ok(run(browserCrypto, 'aes-256-cbc', true, KEY, IV16, expected, off).equals(block));
    });

    it('aes-256-cbc rejects a wrong key with "bad decrypt"', function () {
      const sealed = run(nodeCrypto, 'aes-256-cbc', false, KEY, IV16, PLAINTEXT);
      const wrong = Buffer.from(KEY).fill(7);
      assert.throws(() => run(browserCrypto, 'aes-256-cbc', true, wrong, IV16, sealed), /bad decrypt/);
    });

    it('aes-256-gcm matches Node, including AAD and the auth tag', function () {
      const aad = Buffer.from('header');
      const node = nodeCrypto.createCipheriv('aes-256-gcm', KEY, IV12);
      node.setAAD(aad);
      const expected = Buffer.concat([node.update(PLAINTEXT), node.final()]);
      const tag = node.getAuthTag();

      const ours = browserCrypto.createCipheriv('aes-256-gcm', KEY, IV12);
      ours.setAAD(aad);
      const actual = Buffer.concat([ours.update(PLAINTEXT), ours.final()]);
      assert.ok(actual.equals(expected));
      assert.ok(ours.getAuthTag().equals(tag));

      const opened = run(browserCrypto, 'aes-256-gcm', true, KEY, IV12, expected, (d) => {
        d.setAAD(aad);
        d.setAuthTag(tag);
      });
      assert.ok(opened.equals(PLAINTEXT));
    });

    it('aes-256-gcm refuses a tampered tag or ciphertext', function () {
      const c = browserCrypto.createCipheriv('aes-256-gcm', KEY, IV12);
      const sealed = Buffer.concat([c.update(PLAINTEXT), c.final()]);
      const tag = c.getAuthTag();
      const badTag = Buffer.from(tag);
      badTag[0] ^= 1;
      assert.throws(() => run(browserCrypto, 'aes-256-gcm', true, KEY, IV12, sealed, (d) => d.setAuthTag(badTag)), /unable to authenticate/);
      const badBody = Buffer.from(sealed);
      badBody[0] ^= 1;
      assert.throws(() => run(browserCrypto, 'aes-256-gcm', true, KEY, IV12, badBody, (d) => d.setAuthTag(tag)), /unable to authenticate/);
    });

    it('supports update() with string encodings like Node', function () {
      const expected = (() => {
        const c = nodeCrypto.createCipheriv('aes-256-cbc', KEY, IV16);
        return c.update('hello', 'utf8', 'hex') + c.final('hex');
      })();
      const c = browserCrypto.createCipheriv('aes-256-cbc', KEY, IV16);
      assert.strictEqual(c.update('hello', 'utf8', 'hex') + c.final('hex'), expected);
    });

    it('validates algorithm, key, and IV', function () {
      assert.throws(() => browserCrypto.createCipheriv('des-ede3-cbc', KEY, IV16), /Unknown cipher/);
      assert.throws(() => browserCrypto.createCipheriv('aes-256-cbc', KEY.subarray(0, 16), IV16), /Invalid key length/);
      assert.throws(() => browserCrypto.createCipheriv('aes-256-cbc', KEY, IV12), /Invalid initialization vector/);
      assert.throws(() => browserCrypto.createCipheriv('aes-256-gcm', KEY, IV12, { authTagLength: 8 }), /authTagLength/);
    });

    it('cannot be used after final()', function () {
      const c = browserCrypto.createCipheriv('aes-256-cbc', KEY, IV16);
      c.final();
      assert.throws(() => c.update(PLAINTEXT), /Unsupported state/);
    });
  });

  describe('randomness and comparison', function () {
    it('randomBytes returns Buffers of any size, past the Web Crypto chunk limit', function () {
      const small = browserCrypto.randomBytes(32);
      assert.ok(Buffer.isBuffer(small));
      assert.strictEqual(small.length, 32);
      const large = browserCrypto.randomBytes(70000);
      assert.strictEqual(large.length, 70000);
      assert.ok(large.subarray(65536).some((b) => b !== 0));
    });

    it('randomBytes supports the callback form', function (done) {
      browserCrypto.randomBytes(8, (error, bytes) => {
        assert.ifError(error);
        assert.strictEqual(bytes.length, 8);
        done();
      });
    });

    it('randomUUID returns a v4 UUID', function () {
      assert.match(browserCrypto.randomUUID(), /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    });

    it('timingSafeEqual behaves like Node', function () {
      assert.strictEqual(browserCrypto.timingSafeEqual(Buffer.from('abc'), Buffer.from('abc')), true);
      assert.strictEqual(browserCrypto.timingSafeEqual(Buffer.from('abc'), Buffer.from('abd')), false);
      assert.throws(() => browserCrypto.timingSafeEqual(Buffer.from('a'), Buffer.from('ab')), RangeError);
    });

    it('exposes Web Crypto', function () {
      assert.strictEqual(typeof browserCrypto.subtle.digest, 'function');
      assert.strictEqual(browserCrypto.getRandomValues(new Uint8Array(4)).length, 4);
    });
  });
});
