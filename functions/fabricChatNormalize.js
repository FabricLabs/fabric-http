'use strict';

/**
 * Normalize Fabric shoutbox chat for Hub UI / cache and LiveRelay mesh ingest.
 *
 * Mesh wire (first-class P2P_CHAT_MESSAGE): body = raw UTF-8 text only.
 * Peer emits: `{ text, type: 'P2P_CHAT_MESSAGE' }` (+ meta.signer).
 *
 * Hub SPA / WS may still cache `{ actor, object.content }` — that is the HTTP
 * edge, not the P2P body. Text / author extraction is `@fabric/core`
 * `functions/fabricChatText` (lockfile SHA `2a074a71`).
 */

const {
  chatTextOf,
  chatActorIdOf
} = require('@fabric/core/functions/fabricChatText');

/**
 * Normalize inbound chat into a Hub-cacheable shape for WS UI.
 * @param {object|string} chat
 * @param {{ defaultActorId?: string|null, signer?: string|null }} [opts]
 * @returns {object|null}
 */
function normalizeP2pChatMessage (chat, opts = {}) {
  const text = chatTextOf(chat);
  if (!text.trim()) return null;

  const objIn = (chat && typeof chat === 'object' && chat.object && typeof chat.object === 'object')
    ? chat.object
    : {};
  const actorId = chatActorIdOf(chat, opts) || 'unknown';
  // `Number(null)` and `Number('')` are 0, which is finite — so a plain
  // `isFinite` gate would accept epoch 0 and skip the `ts` fallback, stamping
  // 1970 onto messages that carry a good timestamp. Require a positive value.
  let created = Number(objIn.created);
  if (!(created > 0) && objIn.ts) {
    // Only take a `ts` that actually parsed: assigning Date.now() here would make
    // the outer `chat.created` fallback below unreachable.
    const parsed = Date.parse(objIn.ts);
    if (parsed > 0) created = parsed;
  }
  if (!(created > 0) && chat && typeof chat === 'object' && chat.created != null) {
    created = Number(chat.created);
  }
  if (!(created > 0)) created = Date.now();

  const object = {
    content: text,
    created
  };
  if (objIn.clientId != null) object.clientId = String(objIn.clientId);
  if (objIn.id != null) object.id = String(objIn.id);

  const out = {
    type: 'P2P_CHAT_MESSAGE',
    actor: {
      id: actorId,
      ...(chat && chat.actor && chat.actor.publicKey ? { publicKey: String(chat.actor.publicKey) } : {}),
      ...(chat && chat.actor && chat.actor.pubkey ? { pubkey: String(chat.actor.pubkey) } : {})
    },
    object
  };
  if (chat && typeof chat === 'object' && chat.target != null) out.target = chat.target;
  return out;
}

module.exports = {
  chatTextOf,
  chatActorIdOf,
  normalizeP2pChatMessage
};
