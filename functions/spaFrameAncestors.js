'use strict';

/** Default clickjacking policy for HTML this server writes. */
const DEFAULT_FRAME_ANCESTORS = "frame-ancestors 'self'";

/**
 * Keep a page's own `frame-ancestors`. Otherwise append the default so an
 * HTML response cannot be framed by another site.
 * @param {string} existing Current `Content-Security-Policy` header, if any.
 * @param {string} [policy]
 * @returns {string|null} The header to set, or null when `existing` already decides framing.
 */
function frameAncestorsHeader (existing, policy) {
  const directive = policy || DEFAULT_FRAME_ANCESTORS;
  const current = existing == null ? '' : String(existing);
  if (/frame-ancestors/i.test(current)) return null;
  if (!current.trim()) return directive;
  return `${current.replace(/;\s*$/, '')}; ${directive}`;
}

/**
 * Wrap `res.setHeader` so an HTML `Content-Type` carries `frame-ancestors`,
 * without replacing a policy the page already set.
 * @param {Object} res
 * @param {string|false} [policy] `false` leaves the response alone.
 * @returns {void}
 */
function attachFrameAncestors (res, policy) {
  if (!res || policy === false || typeof res.setHeader !== 'function') return;
  const directive = typeof policy === 'string' && policy.trim() ? policy.trim() : DEFAULT_FRAME_ANCESTORS;
  const orig = res.setHeader;
  res.setHeader = function setHeaderWithFrameAncestors (name, value) {
    const key = String(name).toLowerCase();
    if (key === 'content-security-policy' && this._fabricHtml && !/frame-ancestors/i.test(String(value))) {
      value = frameAncestorsHeader(value, directive);
    }
    const result = orig.call(this, name, value);
    if (key === 'content-type' && /text\/html/i.test(String(value))) {
      this._fabricHtml = true;
      const existing = this.getHeader('Content-Security-Policy');
      const next = frameAncestorsHeader(existing, directive);
      if (next != null) orig.call(this, 'Content-Security-Policy', next);
    }
    return result;
  };
}

module.exports = {
  DEFAULT_FRAME_ANCESTORS,
  frameAncestorsHeader,
  attachFrameAncestors
};
