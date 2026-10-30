'use strict';

/**
 * @fileoverview Passport v2 relying party: issue challenges for pinned
 * origins, redeem assertions once, and keep hashed sessions. No HTTP here —
 * {@link module:functions/passportHttp} mounts it.
 *
 * - **Pinned origins.** A challenge is only ever issued for an origin in
 *   `pinnedOrigins`; nothing is derived from the `Host` header. An empty list
 *   refuses to start in production; elsewhere it allows loopback origins only.
 * - **Binding secret.** Each challenge comes with 32 random bytes the browser
 *   keeps in an HttpOnly cookie. The store is keyed by sha256(secret), so an
 *   assertion lifted from the page can't be redeemed without that cookie.
 * - **Redeem once.** `redeem` takes the record out of the store atomically
 *   before verifying anything.
 * - **Sessions.** Random tokens, stored as sha256(token).
 */

const crypto = require('crypto');
const passport = require('@fabric/core/functions/passport');
const { isLoopbackHostname, tokensEqual } = require('./httpRequestTrust');

/** Default session lifetime. */
const PASSPORT_SESSION_TTL_MS = 24 * 60 * 60 * 1000;
/** Most pending challenges an in-memory store keeps. */
const MEMORY_STORE_MAX = 10000;
/** Most live sessions the default in-memory session store keeps. */
const MEMORY_SESSION_STORE_MAX = 100000;

/**
 * sha256 hex of a secret or token.
 * @param {string} value
 * @returns {string}
 */
function hashSecret (value) {
  return crypto.createHash('sha256').update(String(value || ''), 'utf8').digest('hex');
}

/**
 * @private
 * @returns {string}
 */
function randomToken () {
  return crypto.randomBytes(32).toString('hex');
}

/**
 * In-memory store: `put`, atomic `take`, `get`, `delete`. Entries expire at
 * `expiresAt`. A new key past `max` is refused; nothing already stored is
 * dropped to make room.
 * @param {Object} [options]
 * @param {number} [options.max]
 * @param {function(): number} [options.now]
 * @returns {{ put: function(string, object): Promise<void>, take: function(string): Promise<(object|null)>, get: function(string): Promise<(object|null)>, delete: function(string): Promise<void>, size: function(): number }}
 */
function createMemoryStore (options = {}) {
  const max = Number.isFinite(options.max) && options.max > 0 ? options.max : MEMORY_STORE_MAX;
  const now = typeof options.now === 'function' ? options.now : Date.now;
  const rows = new Map();
  const live = (row) => row && (!row.expiresAt || row.expiresAt > now());
  return {
    async put (key, value) {
      for (const [id, row] of rows) {
        if (!live(row)) rows.delete(id);
      }
      if (!rows.has(key) && rows.size >= max) {
        const err = new Error('too many pending records');
        err.status = 503;
        throw err;
      }
      rows.delete(key);
      rows.set(key, value);
    },
    async take (key) {
      const row = rows.get(key);
      rows.delete(key);
      return live(row) ? row : null;
    },
    async get (key) {
      const row = rows.get(key);
      if (!row) return null;
      if (!live(row)) {
        rows.delete(key);
        return null;
      }
      return row;
    },
    async delete (key) {
      rows.delete(key);
    },
    size () {
      return rows.size;
    }
  };
}

/**
 * @private
 * @param {*} list
 * @returns {string[]}
 */
function normalizePinned (list) {
  const items = Array.isArray(list) ? list : String(list || '').split(',');
  const out = [];
  for (const item of items) {
    const origin = passport.normalizeOrigin(String(item || '').trim());
    if (origin && !out.includes(origin)) out.push(origin);
  }
  return out;
}

/**
 * @private
 * @param {string} origin
 * @returns {boolean}
 */
function isLoopbackOrigin (origin) {
  try {
    return isLoopbackHostname(new URL(origin).hostname);
  } catch (_) {
    return false;
  }
}

/**
 * Create a relying party.
 * @param {Object} settings
 * @param {string[]|string} settings.pinnedOrigins Origins this service answers for.
 * @param {boolean} [settings.production] Default `NODE_ENV === 'production'`.
 * @param {string} [settings.network] Network named in every challenge.
 * @param {string} [settings.purpose] Default text shown to the user.
 * @param {string[]} [settings.signers] Accept only these signer labels.
 * @param {number} [settings.challengeTtlMs]
 * @param {number} [settings.sessionTtlMs]
 * @param {object} [settings.challengeStore] `{ put, take }` (default in-memory).
 * @param {object} [settings.sessionStore] `{ put, get, delete }` (default in-memory).
 * @param {object} [settings.key] Site key that signs challenges (optional).
 * @param {function(): number} [settings.now]
 * @returns {object}
 */
function createPassportRelyingParty (settings = {}) {
  const production = settings.production != null ? !!settings.production : process.env.NODE_ENV === 'production';
  const pinnedOrigins = normalizePinned(settings.pinnedOrigins);
  if (!pinnedOrigins.length && production) {
    throw new Error('Passport: pinnedOrigins is required in production');
  }
  const now = typeof settings.now === 'function' ? settings.now : Date.now;
  const network = settings.network ? String(settings.network) : null;
  const signers = Array.isArray(settings.signers) ? settings.signers.slice() : null;
  const sessionTtlMs = Number.isFinite(settings.sessionTtlMs) && settings.sessionTtlMs > 0
    ? settings.sessionTtlMs
    : PASSPORT_SESSION_TTL_MS;
  const challengeStore = settings.challengeStore || createMemoryStore({ now });
  const sessionStore = settings.sessionStore || createMemoryStore({ now, max: MEMORY_SESSION_STORE_MAX });

  /**
   * The pinned origin for `candidate`, or null.
   * @param {string} [candidate]
   * @returns {string|null}
   */
  function resolveOrigin (candidate) {
    const origin = candidate ? passport.normalizeOrigin(candidate) : null;
    if (origin && pinnedOrigins.includes(origin)) return origin;
    if (origin && !pinnedOrigins.length && isLoopbackOrigin(origin)) return origin;
    if (!candidate && pinnedOrigins.length === 1) return pinnedOrigins[0];
    return null;
  }

  /**
   * Issue a challenge and its binding secret.
   * @param {Object} [params]
   * @param {string} [params.origin] Must be pinned (defaults to the only pinned origin).
   * @param {string[]} [params.request] `wallet` and/or `cosigner`.
   * @param {string} [params.purpose]
   * @returns {Promise<{ challenge: string, hash: string, expiresAt: number, origin: string, network: (string|null), request: string[], bindingSecret: string }>}
   */
  async function issueChallenge (params = {}) {
    const origin = resolveOrigin(params.origin);
    if (!origin) {
      const err = new Error('origin is not pinned for this service');
      err.status = 403;
      throw err;
    }
    const created = passport.createChallenge({
      origin,
      network,
      request: params.request,
      purpose: params.purpose != null ? params.purpose : settings.purpose,
      ttlMs: settings.challengeTtlMs,
      now: now()
    }, settings.key || null);
    const bindingSecret = randomToken();
    await challengeStore.put(hashSecret(bindingSecret), {
      nonce: created.nonce,
      origin,
      challengeHash: created.hash,
      network: created.network,
      request: created.request,
      expiresAt: created.expiresAt
    });
    return {
      challenge: created.uri,
      hash: created.hash,
      expiresAt: created.expiresAt,
      origin,
      network: created.network,
      request: created.request,
      bindingSecret
    };
  }

  /**
   * Redeem an assertion with the binding secret of its challenge. The
   * challenge is spent whether or not the assertion verifies.
   * @param {string} bindingSecret
   * @param {string} assertion `fabric:` string
   * @returns {Promise<{ ok: true, origin: string, identity: object, network: string, signer: string, device: (string|null), wallet: (object|null), cosigner: (object|null) }|{ ok: false, status: number, error: string }>}
   */
  async function redeem (bindingSecret, assertion) {
    if (!bindingSecret || typeof bindingSecret !== 'string') {
      return { ok: false, status: 400, error: 'challenge binding missing' };
    }
    if (typeof assertion !== 'string' || !assertion.trim()) {
      return { ok: false, status: 400, error: 'assertion required' };
    }
    const record = await challengeStore.take(hashSecret(bindingSecret));
    if (!record) return { ok: false, status: 400, error: 'unknown, used, or expired challenge' };
    const verified = passport.verifyAssertion(assertion.trim(), {
      origin: record.origin,
      nonce: record.nonce,
      challengeHash: record.challengeHash,
      network: record.network,
      allow: record.request,
      challengeExpiresAt: record.expiresAt,
      signers,
      now: now()
    });
    if (!verified.ok) return { ok: false, status: 400, error: verified.error };
    return Object.assign({ origin: record.origin }, verified);
  }

  /**
   * Start a session for a verified assertion.
   * @param {object} verified Output of {@link redeem}.
   * @param {object} [extra] Host fields kept with the session (e.g. a member id).
   * @returns {Promise<{ token: string, session: object }>}
   */
  async function issueSession (verified, extra = {}) {
    if (!verified || !verified.ok || !verified.identity) throw new TypeError('verified assertion required');
    const token = randomToken();
    const issuedAt = now();
    const session = Object.assign({}, extra, {
      identityId: verified.identity.id,
      pubkey: verified.identity.pubkey,
      network: verified.network,
      signer: verified.signer,
      origin: verified.origin,
      wallet: verified.wallet || null,
      cosigner: verified.cosigner || null,
      issuedAt,
      expiresAt: issuedAt + sessionTtlMs
    });
    await sessionStore.put(hashSecret(token), session);
    return { token, session };
  }

  /**
   * @param {string} token
   * @returns {Promise<object|null>}
   */
  async function readSession (token) {
    if (!token || typeof token !== 'string' || !/^[0-9a-f]{64}$/.test(token)) return null;
    const session = await sessionStore.get(hashSecret(token));
    if (!session || (session.expiresAt && session.expiresAt <= now())) return null;
    return session;
  }

  /**
   * @param {string} token
   * @returns {Promise<void>}
   */
  async function revokeSession (token) {
    if (!token || typeof token !== 'string') return;
    await sessionStore.delete(hashSecret(token));
  }

  /**
   * The public part of a session (no token, no hashes).
   * @param {object} session
   * @returns {object}
   */
  function sessionView (session) {
    if (!session) return null;
    const view = {
      identity: { id: session.identityId, pubkey: session.pubkey },
      network: session.network,
      signer: session.signer,
      origin: session.origin,
      issuedAt: session.issuedAt,
      expiresAt: session.expiresAt
    };
    if (session.wallet) view.wallet = session.wallet;
    if (session.cosigner) view.cosigner = { pubkey: session.cosigner.pubkey };
    return view;
  }

  return {
    pinnedOrigins: pinnedOrigins.slice(),
    production,
    network,
    resolveOrigin,
    issueChallenge,
    redeem,
    issueSession,
    readSession,
    revokeSession,
    sessionView
  };
}

module.exports = {
  PASSPORT_SESSION_TTL_MS,
  hashSecret,
  tokensEqual,
  createMemoryStore,
  createPassportRelyingParty
};
