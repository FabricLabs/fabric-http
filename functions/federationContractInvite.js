'use strict';

/**
 * Federation contract invite JSON (HTTP / app edge).
 *
 * Shared by Hub and GoonCitizen. Lives in `@fabric/http` so `@fabric/core`
 * stays free of invite JSON parse/build. Body `type` names are catalogued in
 * `@fabric/core/functions/applicationNamespaces`.
 *
 * v2 optional fields include Hub co-signer policy plus GoonCitizen labels:
 * `inviteePubkey`, `groupId`, `groupName`.
 */

const FEDERATION_CONTRACT_INVITE = 'FederationContractInvite';
const FEDERATION_CONTRACT_INVITE_RESPONSE = 'FederationContractInviteResponse';

/**
 * @param {unknown} raw
 * @returns {{ mode: 'percent'|'sats', value: number }|null}
 */
function normalizeSpendingTerms (raw) {
  if (!raw || typeof raw !== 'object') return null;
  const mode = String(raw.mode || '').toLowerCase();
  if (mode !== 'percent' && mode !== 'sats') return null;
  const value = Number(raw.value);
  if (!Number.isFinite(value) || value < 0) return null;
  if (mode === 'percent' && value > 100) return null;
  return { mode, value };
}

/**
 * @param {unknown} raw
 * @returns {{ validators: string[], threshold: number }|null}
 */
function normalizeProposedPolicy (raw) {
  if (!raw || typeof raw !== 'object') return null;
  const validators = Array.isArray(raw.validators)
    ? raw.validators.map((v) => String(v || '').trim()).filter(Boolean)
    : [];
  if (validators.length === 0) return null;
  const unique = new Set(validators.map((v) => v.toLowerCase()));
  if (unique.size !== validators.length) return null;
  if (!Number.isInteger(raw.threshold)) return null;
  const threshold = raw.threshold;
  if (threshold < 1 || threshold > validators.length) return null;
  return { validators, threshold };
}

/**
 * When v2 policy fields are present, they must normalize successfully.
 * @param {object} invite
 * @returns {boolean}
 */
function validateInviteV2PolicyFields (invite) {
  if (!invite || typeof invite !== 'object') return false;
  if (Object.prototype.hasOwnProperty.call(invite, 'spendingTerms')) {
    if (normalizeSpendingTerms(invite.spendingTerms) == null) return false;
  }
  if (Object.prototype.hasOwnProperty.call(invite, 'proposedPolicy')) {
    if (normalizeProposedPolicy(invite.proposedPolicy) == null) return false;
  }
  return true;
}

function parseFederationContractInvite (content) {
  if (!content || typeof content !== 'string') return null;
  try {
    const p = JSON.parse(content);
    if (!p || p.type !== FEDERATION_CONTRACT_INVITE) return null;
    const ver = Number(p.v);
    if (ver !== 1 && ver !== 2) return null;
    if (!p.inviteId || typeof p.inviteId !== 'string') return null;
    if (!validateInviteV2PolicyFields(p)) return null;
    return p;
  } catch (_) {
    return null;
  }
}

/** Parse invite from a string or already-parsed object. */
function parseFederationContractInviteLoose (value) {
  if (value && typeof value === 'object' && value.type === FEDERATION_CONTRACT_INVITE) {
    const ver = Number(value.v);
    if (ver !== 1 && ver !== 2) return null;
    if (!value.inviteId || typeof value.inviteId !== 'string') return null;
    if (!validateInviteV2PolicyFields(value)) return null;
    return value;
  }
  return parseFederationContractInvite(value);
}

function parseFederationContractInviteResponse (content) {
  if (!content || typeof content !== 'string') return null;
  try {
    const p = JSON.parse(content);
    if (!p || p.type !== FEDERATION_CONTRACT_INVITE_RESPONSE) return null;
    if (Number(p.v) !== 1) return null;
    if (!p.inviteId || typeof p.inviteId !== 'string') return null;
    if (typeof p.accept !== 'boolean') return null;
    return p;
  } catch (_) {
    return null;
  }
}

function parseFederationContractInviteResponseLoose (value) {
  if (value && typeof value === 'object' && value.type === FEDERATION_CONTRACT_INVITE_RESPONSE) {
    if (Number(value.v) !== 1) return null;
    if (!value.inviteId || typeof value.inviteId !== 'string') return null;
    if (typeof value.accept !== 'boolean') return null;
    return value;
  }
  return parseFederationContractInviteResponse(value);
}

function buildFederationContractInviteJson (fields) {
  const spendingTerms = fields && fields.spendingTerms != null
    ? normalizeSpendingTerms(fields.spendingTerms)
    : null;
  const proposedPolicy = fields && fields.proposedPolicy != null
    ? normalizeProposedPolicy(fields.proposedPolicy)
    : null;
  const termsSummary = fields && fields.termsSummary != null && String(fields.termsSummary).trim()
    ? String(fields.termsSummary).trim().slice(0, 2000)
    : null;
  const publishSessionId = fields && fields.publishSessionId != null && String(fields.publishSessionId).trim()
    ? String(fields.publishSessionId).trim().slice(0, 128)
    : null;
  const inviteePubkey = fields && fields.inviteePubkey != null && String(fields.inviteePubkey).trim()
    ? String(fields.inviteePubkey).trim().toLowerCase()
    : null;
  const groupId = fields && fields.groupId != null && String(fields.groupId).trim()
    ? String(fields.groupId).trim().slice(0, 128)
    : null;
  const groupName = fields && fields.groupName != null && String(fields.groupName).trim()
    ? String(fields.groupName).trim().slice(0, 80)
    : null;
  let role = null;
  if (fields && fields.role != null && String(fields.role).trim()) {
    const r = String(fields.role).trim().toLowerCase();
    if (r === 'reader' || r === 'signer') role = r;
  }
  const capabilityToken = fields && fields.capabilityToken != null && String(fields.capabilityToken).trim()
    ? String(fields.capabilityToken).trim().slice(0, 8192)
    : null;
  // Default Hub co-signer UX: signer. Explicit reader for read-only joins.
  const effectiveRole = role || (capabilityToken || inviteePubkey || groupId ? 'signer' : null);
  const extended = !!(spendingTerms || proposedPolicy || termsSummary || publishSessionId
    || inviteePubkey || groupId || groupName || role || capabilityToken);
  const doc = {
    type: FEDERATION_CONTRACT_INVITE,
    v: extended ? 2 : 1,
    inviteId: fields.inviteId,
    inviterHubId: fields.inviterHubId != null ? String(fields.inviterHubId) : null,
    contractId: fields.contractId != null && String(fields.contractId).trim()
      ? String(fields.contractId).trim()
      : null,
    note: fields.note != null && String(fields.note).trim() ? String(fields.note).trim().slice(0, 2000) : null,
    invitedAt: fields.invitedAt != null ? Number(fields.invitedAt) : Date.now()
  };
  if (spendingTerms) doc.spendingTerms = spendingTerms;
  if (proposedPolicy) doc.proposedPolicy = proposedPolicy;
  if (termsSummary) doc.termsSummary = termsSummary;
  if (publishSessionId) doc.publishSessionId = publishSessionId;
  if (inviteePubkey) doc.inviteePubkey = inviteePubkey;
  if (groupId) doc.groupId = groupId;
  if (groupName) doc.groupName = groupName;
  if (effectiveRole) doc.role = effectiveRole;
  if (capabilityToken) doc.capabilityToken = capabilityToken;
  return JSON.stringify(doc);
}

function buildFederationContractInvite (fields) {
  return JSON.parse(buildFederationContractInviteJson(fields));
}

function buildFederationContractInviteResponseJson (fields) {
  if (!fields || typeof fields.accept !== 'boolean') {
    throw new TypeError('accept must be a boolean');
  }
  return JSON.stringify({
    type: FEDERATION_CONTRACT_INVITE_RESPONSE,
    v: 1,
    inviteId: String(fields.inviteId || ''),
    accept: fields.accept,
    responderPubkey: fields.responderPubkey != null && String(fields.responderPubkey).trim()
      ? String(fields.responderPubkey).trim()
      : null,
    respondedAt: fields.respondedAt != null ? Number(fields.respondedAt) : Date.now()
  });
}

function buildFederationContractInviteResponse (fields) {
  return JSON.parse(buildFederationContractInviteResponseJson(fields));
}

/**
 * @param {object} invite - parsed invite
 * @returns {string}
 */
function formatFederationInviteSpendingSummary (invite) {
  const st = invite && normalizeSpendingTerms(invite.spendingTerms);
  if (!st) return '';
  if (st.mode === 'percent') return `Spending cap: ${st.value}% of treasury per agreement`;
  return `Spending cap: ${st.value} sats per agreement`;
}

module.exports = {
  FEDERATION_CONTRACT_INVITE,
  FEDERATION_CONTRACT_INVITE_RESPONSE,
  normalizeSpendingTerms,
  normalizeProposedPolicy,
  validateInviteV2PolicyFields,
  formatFederationInviteSpendingSummary,
  parseFederationContractInvite,
  parseFederationContractInviteLoose,
  parseFederationContractInviteResponse,
  parseFederationContractInviteResponseLoose,
  buildFederationContractInviteJson,
  buildFederationContractInvite,
  buildFederationContractInviteResponseJson,
  buildFederationContractInviteResponse
};
