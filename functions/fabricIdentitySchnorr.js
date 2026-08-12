'use strict';

/**
 * Shared Fabric protocol identity Schnorr helpers (site-login + device-link).
 *
 * Signing ALWAYS uses {@link Identity#fabricKey} (`FABRIC_KEY_DERIVATION_PATH`)
 * when an HD master is available. Watch-only / leaf nodes fall back to the
 * provided key (same rule as `@fabric/core` Identity.fabricKey).
 *
 * Verify: BIP340 over UTF-8 message; `identity.xpub` must neuter to `pubkeyHex`;
 * `identity.id` must be Bech32 `id1…` of SHA-256d(compressed pubkey) (IDENTITY.md).
 */

const Key = require('@fabric/core/types/key');
const Identity = require('@fabric/core/types/identity');
const Hash256 = require('@fabric/core/types/hash256');
const Bech32 = require('@fabric/core/types/bech32');

/**
 * Fabric Bech32 identity id from a compressed secp256k1 pubkey (IDENTITY.md).
 * @param {string} pubkeyHex
 * @returns {string}
 */
function fabricIdentityIdFromPubkeyHex (pubkeyHex) {
  const input = Buffer.from(String(pubkeyHex || '').trim(), 'hex');
  if (!input.length) throw new Error('Missing pubkey bytes.');
  const pubkeyhash = Hash256.digest(input);
  return new Bech32({ hrp: 'id', content: pubkeyhash }).toString();
}

/**
 * @param {*} value
 * @returns {boolean}
 */
function looksLikeFabricIdentity (value) {
  if (!value || typeof value !== 'object') return false;
  if (typeof value.id !== 'string' && typeof value.id !== 'number') return false;
  // Prefer Identity#fabricKey when present (current @fabric/core).
  if (value.fabricKey && typeof value.fabricKey.signSchnorr === 'function') return true;
  // Older Identity builds (or plain wrappers) expose `.key` without fabricKey.
  return !!(value.key && typeof value.key.signSchnorr === 'function');
}

/**
 * @param {*} value
 * @returns {boolean}
 */
function looksLikeFabricKey (value) {
  return !!(value && typeof value === 'object' &&
    typeof value.signSchnorr === 'function' &&
    (value.pubkey || value.public || value.xprv || value.xpub || value.master));
}

/**
 * Resolve the protocol signing key + Fabric bech32 id from flexible inputs.
 * @param {object|import('@fabric/core/types/identity')|import('@fabric/core/types/key')} input
 *   Identity, HD Key / master, `{ mnemonic|xprv }`, or leaf
 *   `{ privateKeyHex|private, xpub? }` (Passport session material already at the Fabric path).
 * @returns {{ fabricKey: object, identityId: string, identity: object }}
 */
function resolveFabricSigningIdentity (input) {
  if (!input) throw new Error('Identity or Key required');

  let identity = null;
  let leafXpub = null;
  if (looksLikeFabricIdentity(input)) {
    identity = input;
  } else if (looksLikeFabricKey(input)) {
    identity = new Identity(input);
  } else if (typeof input === 'object') {
    if (input.mnemonic || input.xprv) {
      identity = new Identity(new Key({
        mnemonic: input.mnemonic || undefined,
        xprv: input.xprv || undefined,
        passphrase: input.passphrase || undefined
      }));
    } else {
      const priv = input.privateKeyHex || input.private || null;
      if (priv) {
        const hex = Buffer.isBuffer(priv) ? priv.toString('hex') : String(priv).replace(/^0x/i, '');
        const leaf = new Key({ private: hex });
        // Leaf keys have no HD master — fabricKey falls back to the leaf itself.
        identity = new Identity(leaf);
        leafXpub = typeof input.xpub === 'string' ? input.xpub : null;
      }
    }
  }

  if (!identity) throw new Error('Identity or Key required');

  let fabricKey = identity.fabricKey;
  // Older @fabric/core Identity builds may lack the fabricKey getter — derive the
  // protocol path from the master Key (same rule as Identity#fabricKey).
  if (!fabricKey || typeof fabricKey.signSchnorr !== 'function') {
    const master = identity.key || identity.master || (looksLikeFabricKey(input) ? input : null);
    if (master && typeof master.derive === 'function') {
      try {
        const { FABRIC_KEY_DERIVATION_PATH } = require('@fabric/core/constants');
        const path = (identity.derivation) || FABRIC_KEY_DERIVATION_PATH;
        fabricKey = master.derive(path);
      } catch (_) {
        fabricKey = master;
      }
    } else if (master && typeof master.signSchnorr === 'function') {
      fabricKey = master;
    }
  }
  if (!fabricKey || typeof fabricKey.signSchnorr !== 'function') {
    throw new Error('Fabric signing key unavailable');
  }

  let xpub = fabricKey.xpub || leafXpub || null;
  if (!xpub && typeof input === 'object' && typeof input.xpub === 'string') {
    xpub = input.xpub;
  }
  if (!xpub) {
    throw new Error('Fabric signing key missing xpub (pass identity.xpub for leaf keys)');
  }
  if (!fabricKey.xpub) {
    fabricKey.xpub = String(xpub);
  }

  return {
    fabricKey,
    identityId: String(identity.id),
    identity
  };
}

/**
 * Build the JSON body Hub / LiveRelay expect for client-signed challenges.
 * @param {object|import('@fabric/core/types/identity')|import('@fabric/core/types/key')} input
 * @param {string} message UTF-8 challenge string
 * @returns {{ signature: string, pubkeyHex: string, identity: { id: string, xpub: string } }}
 */
function buildFabricIdentitySignedPayload (input, message) {
  if (typeof message !== 'string' || !message) {
    throw new Error('message required');
  }
  const { fabricKey, identityId } = resolveFabricSigningIdentity(input);
  const signature = Buffer.from(fabricKey.signSchnorr(Buffer.from(message, 'utf8'))).toString('hex');
  const pubkeyHex = String(fabricKey.pubkey || '');
  if (!/^[a-f0-9]{66}$/i.test(pubkeyHex)) {
    throw new Error('Could not derive Fabric public key');
  }
  const xpub = String(fabricKey.xpub || '');
  if (!xpub) throw new Error('Fabric signing key missing xpub');
  return {
    signature,
    pubkeyHex,
    identity: { id: identityId, xpub }
  };
}

/**
 * Verify Schnorr + identity.id matches the signing pubkey (Fabric IDENTITY.md).
 * @param {string} message
 * @param {string} signatureHex
 * @param {string} pubkeyHex
 * @param {{ id?: *, xpub: string }} identity
 * @returns {{ ok: true, key: object, identityId: string }|{ ok: false, error: string }}
 */
function verifyIdentitySchnorr (message, signatureHex, pubkeyHex, identity) {
  if (typeof message !== 'string' || !message) {
    return { ok: false, error: 'Missing signed message' };
  }
  if (typeof signatureHex !== 'string' || !/^[a-f0-9]{128}$/i.test(signatureHex)) {
    return { ok: false, error: 'Missing or invalid signature' };
  }
  if (typeof pubkeyHex !== 'string' || !/^[a-f0-9]{66}$/i.test(pubkeyHex)) {
    return { ok: false, error: 'Missing or invalid pubkey' };
  }
  if (!identity || typeof identity !== 'object' || typeof identity.xpub !== 'string' || !identity.xpub) {
    return { ok: false, error: 'Missing identity xpub' };
  }
  let key;
  try {
    key = new Key({ xpub: identity.xpub });
  } catch (_) {
    return { ok: false, error: 'Invalid xpub' };
  }
  const msgBuf = Buffer.from(message, 'utf8');
  let sigBuf;
  try {
    sigBuf = Buffer.from(signatureHex, 'hex');
  } catch (_) {
    return { ok: false, error: 'Invalid signature encoding' };
  }
  if (!key.verifySchnorr(msgBuf, sigBuf)) {
    return { ok: false, error: 'Signature verification failed' };
  }
  const compressedPub = String(key.pubkey || '').toLowerCase();
  if (compressedPub !== String(pubkeyHex).toLowerCase()) {
    return { ok: false, error: 'Public key does not match xpub' };
  }
  let expectedId;
  try {
    expectedId = fabricIdentityIdFromPubkeyHex(pubkeyHex);
  } catch (_) {
    return { ok: false, error: 'Could not derive identity from pubkey' };
  }
  const claimedId = identity.id != null ? String(identity.id).trim() : '';
  if (!claimedId || String(expectedId) !== claimedId) {
    return { ok: false, error: 'Identity id does not match xpub' };
  }
  return { ok: true, key, identityId: claimedId };
}

module.exports = {
  fabricIdentityIdFromPubkeyHex,
  resolveFabricSigningIdentity,
  buildFabricIdentitySignedPayload,
  verifyIdentitySchnorr
};
