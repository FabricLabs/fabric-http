'use strict';

/**
 * @fileoverview The subset of Node's `crypto` module that Fabric browser code
 * calls, built on `@noble/hashes`, `@noble/ciphers`, and Web Crypto randomness.
 * Bundlers map `crypto` / `node:crypto` here (see `types/compiler.js`) in place
 * of `crypto-browserify`, which pulled in `elliptic`, `asn1.js`, and the
 * `browserify-*` stack for signing and RSA APIs Fabric never uses in a browser.
 *
 * Everything is synchronous, like Node: hashes, HMAC, PBKDF2, HKDF, AES
 * (GCM / CBC / CTR), random bytes, and constant-time comparison. Ciphers buffer
 * their input and return it all from `final()`, so `update()` returns an empty
 * result; callers that concatenate `update()` and `final()` see Node's output.
 * Anything else (signing, ECDH, RSA, scrypt) is absent: use `@noble/curves` or
 * `crypto.subtle` for those.
 *
 * @module functions/browserCrypto
 */

const { Buffer } = require('buffer');
const { sha224, sha256, sha384, sha512 } = require('@noble/hashes/sha2.js');
const { sha1, ripemd160 } = require('@noble/hashes/legacy.js');
const { hmac } = require('@noble/hashes/hmac.js');
const { pbkdf2 } = require('@noble/hashes/pbkdf2.js');
const { hkdf } = require('@noble/hashes/hkdf.js');
const { gcm, cbc, ctr } = require('@noble/ciphers/aes.js');

const HASHES = {
  sha1,
  sha224,
  sha256,
  sha384,
  sha512,
  ripemd160,
  rmd160: ripemd160
};

const CIPHERS = { gcm, cbc, ctr };

// Web Crypto refuses more than 65536 bytes per getRandomValues call.
const RANDOM_CHUNK = 65536;

const GCM_TAG_BYTES = 16;

/** @private */
function webcrypto () {
  const c = typeof globalThis !== 'undefined' ? globalThis.crypto : undefined;
  if (!c || typeof c.getRandomValues !== 'function') {
    throw new Error('crypto.getRandomValues is not available in this environment');
  }
  return c;
}

/** @private */
function hashFor (algorithm) {
  const name = String(algorithm || '').toLowerCase().replace(/-/g, '');
  const fn = HASHES[name];
  if (!fn) throw new Error(`Digest method not supported: ${algorithm}`);
  return fn;
}

/** @private */
function toBytes (data, encoding) {
  if (typeof data === 'string') return Buffer.from(data, encoding || 'utf8');
  if (data instanceof Uint8Array) return data;
  if (ArrayBuffer.isView(data)) return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  throw new TypeError('The "data" argument must be of type string or an instance of Buffer, TypedArray, DataView, or ArrayBuffer');
}

/** @private */
function output (bytes, encoding) {
  const buffer = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return encoding && encoding !== 'buffer' ? buffer.toString(encoding) : buffer;
}

class Hash {
  constructor (algorithm, state) {
    this._state = state || hashFor(algorithm).create();
  }

  update (data, encoding) {
    this._state.update(toBytes(data, encoding));
    return this;
  }

  digest (encoding) {
    return output(this._state.digest(), encoding);
  }

  copy () {
    return new Hash(null, this._state.clone());
  }
}

class Hmac {
  constructor (algorithm, key) {
    this._state = hmac.create(hashFor(algorithm), toBytes(key));
  }

  update (data, encoding) {
    this._state.update(toBytes(data, encoding));
    return this;
  }

  digest (encoding) {
    return output(this._state.digest(), encoding);
  }
}

/** @private */
function parseCipher (algorithm, key, iv) {
  const match = /^aes-(128|192|256)-(gcm|cbc|ctr)$/.exec(String(algorithm || '').toLowerCase());
  if (!match) throw new Error(`Unknown cipher: ${algorithm}`);
  const keyBytes = toBytes(key);
  if (keyBytes.length !== Number(match[1]) / 8) throw new RangeError('Invalid key length');
  const ivBytes = toBytes(iv);
  const mode = match[2];
  if (mode === 'gcm' ? ivBytes.length === 0 : ivBytes.length !== 16) {
    throw new TypeError('Invalid initialization vector');
  }
  return { mode, key: keyBytes, iv: ivBytes };
}

/** @private */
function checkTagLength (options) {
  if (options && options.authTagLength != null && options.authTagLength !== GCM_TAG_BYTES) {
    throw new Error(`Unsupported authTagLength ${options.authTagLength}; only ${GCM_TAG_BYTES} is available`);
  }
}

class CipherBase {
  constructor (decrypt, algorithm, key, iv, options) {
    Object.assign(this, parseCipher(algorithm, key, iv));
    if (this.mode === 'gcm') checkTagLength(options);
    this._decrypt = decrypt;
    this._chunks = [];
    this._aad = undefined;
    this._padding = true;
    this._tag = null;
    this._done = false;
  }

  _live () {
    if (this._done) throw new Error('Unsupported state');
  }

  update (data, inputEncoding, outputEncoding) {
    this._live();
    this._chunks.push(Buffer.from(toBytes(data, inputEncoding)));
    return output(new Uint8Array(0), outputEncoding);
  }

  setAAD (aad) {
    this._live();
    if (this.mode !== 'gcm') throw new Error('setAAD is only available for GCM');
    this._aad = toBytes(aad);
    return this;
  }

  setAutoPadding (padding = true) {
    this._live();
    this._padding = padding !== false;
    return this;
  }

  _cipher () {
    if (this.mode === 'gcm') return CIPHERS.gcm(this.key, this.iv, this._aad);
    if (this.mode === 'cbc') return CIPHERS.cbc(this.key, this.iv, { disablePadding: !this._padding });
    return CIPHERS.ctr(this.key, this.iv);
  }
}

class Cipheriv extends CipherBase {
  constructor (algorithm, key, iv, options) {
    super(false, algorithm, key, iv, options);
  }

  final (outputEncoding) {
    this._live();
    this._done = true;
    let sealed = this._cipher().encrypt(Buffer.concat(this._chunks));
    if (this.mode === 'gcm') {
      this._tag = Buffer.from(sealed.subarray(sealed.length - GCM_TAG_BYTES));
      sealed = sealed.subarray(0, sealed.length - GCM_TAG_BYTES);
    }
    return output(sealed, outputEncoding);
  }

  getAuthTag () {
    if (this.mode !== 'gcm' || !this._tag) throw new Error('Attempting to get auth tag in unsupported state');
    return Buffer.from(this._tag);
  }
}

class Decipheriv extends CipherBase {
  constructor (algorithm, key, iv, options) {
    super(true, algorithm, key, iv, options);
  }

  setAuthTag (tag) {
    this._live();
    if (this.mode !== 'gcm') throw new Error('setAuthTag is only available for GCM');
    const bytes = toBytes(tag);
    if (bytes.length !== GCM_TAG_BYTES) throw new Error(`Invalid authentication tag length: ${bytes.length}`);
    this._tag = Buffer.from(bytes);
    return this;
  }

  final (outputEncoding) {
    this._live();
    this._done = true;
    let input = Buffer.concat(this._chunks);
    if (this.mode === 'gcm') {
      if (!this._tag) throw new Error('Unsupported state or unable to authenticate data');
      input = Buffer.concat([input, this._tag]);
    }
    let plain;
    try {
      plain = this._cipher().decrypt(input);
    } catch (exception) {
      throw new Error(this.mode === 'gcm' ? 'Unsupported state or unable to authenticate data' : 'bad decrypt');
    }
    return output(plain, outputEncoding);
  }
}

function createHash (algorithm) {
  return new Hash(algorithm);
}

function createHmac (algorithm, key) {
  return new Hmac(algorithm, key);
}

function createCipheriv (algorithm, key, iv, options) {
  return new Cipheriv(algorithm, key, iv, options);
}

function createDecipheriv (algorithm, key, iv, options) {
  return new Decipheriv(algorithm, key, iv, options);
}

function getRandomValues (array) {
  return webcrypto().getRandomValues(array);
}

function randomFillSync (view, offset = 0, size) {
  const bytes = toBytes(view);
  const end = size == null ? bytes.length : offset + size;
  for (let i = offset; i < end; i += RANDOM_CHUNK) {
    getRandomValues(bytes.subarray(i, Math.min(end, i + RANDOM_CHUNK)));
  }
  return view;
}

function randomBytes (size, callback) {
  if (!Number.isInteger(size) || size < 0) throw new RangeError(`The "size" argument is out of range: ${size}`);
  const bytes = Buffer.alloc(size);
  randomFillSync(bytes);
  if (typeof callback === 'function') {
    setTimeout(() => callback(null, bytes), 0);
    return undefined;
  }
  return bytes;
}

function randomUUID () {
  const c = webcrypto();
  if (typeof c.randomUUID === 'function') return c.randomUUID();
  const b = randomBytes(16);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const hex = b.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function timingSafeEqual (a, b) {
  const left = toBytes(a);
  const right = toBytes(b);
  if (left.length !== right.length) throw new RangeError('Input buffers must have the same byte length');
  let diff = 0;
  for (let i = 0; i < left.length; i++) diff |= left[i] ^ right[i];
  return diff === 0;
}

function pbkdf2Sync (password, salt, iterations, keylen, digest) {
  const derived = pbkdf2(hashFor(digest), toBytes(password), toBytes(salt), { c: iterations, dkLen: keylen });
  return output(derived);
}

function hkdfSync (digest, ikm, salt, info, keylen) {
  const derived = hkdf(hashFor(digest), toBytes(ikm), toBytes(salt), toBytes(info), keylen);
  return derived.buffer.slice(derived.byteOffset, derived.byteOffset + derived.byteLength);
}

function getHashes () {
  return Object.keys(HASHES);
}

function getCiphers () {
  return ['128', '192', '256'].flatMap((bits) => ['cbc', 'ctr', 'gcm'].map((mode) => `aes-${bits}-${mode}`));
}

module.exports = {
  createHash,
  createHmac,
  createCipheriv,
  createDecipheriv,
  randomBytes,
  randomFillSync,
  randomUUID,
  getRandomValues,
  timingSafeEqual,
  pbkdf2Sync,
  hkdfSync,
  getHashes,
  getCiphers,
  get webcrypto () { return webcrypto(); },
  get subtle () { return webcrypto().subtle; }
};
