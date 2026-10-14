'use strict';

/**
 * @fileoverview Pure, DOM-free view logic for `fabric-document`: sanitize a
 * hash-only `Document#record()`, rank provider offers, and render the record
 * to HTML. No `Service` / `Component` / `Peer` dependency, so browser bundles
 * (e.g. Hub React wrappers) can import it without pulling Node-only modules.
 * `components/document.js` delegates here.
 */

const { escapeHtml } = require('./componentCatalog');

const HEX64 = /^[0-9a-f]{64}$/i;

/**
 * @param {*} v
 * @returns {string}
 * @private
 */
function shortHex (v) {
  const s = String(v == null ? '' : v);
  if (s.length <= 16) return s;
  return s.slice(0, 8) + '…' + s.slice(-8);
}

/**
 * @param {*} v
 * @returns {string|null}
 * @private
 */
function hex64 (v) {
  const s = String(v == null ? '' : v).trim().toLowerCase();
  return HEX64.test(s) ? s : null;
}

/**
 * Manifest URLs come from opened (publisher-controlled) content; only plain
 * web links may become an `href` — `javascript:` and friends render as text.
 * @param {*} v
 * @returns {string|null}
 */
function safeHttpUrl (v) {
  const s = String(v == null ? '' : v).trim();
  if (!s) return null;
  try {
    const u = new URL(s);
    return (u.protocol === 'http:' || u.protocol === 'https:') ? u.href : null;
  } catch (_) {
    return null;
  }
}

/**
 * Keep only hash / key / signature fields from whatever record arrives.
 * @param {Object} record
 * @returns {Object|null}
 */
function sanitizeRecord (record) {
  if (!record || typeof record !== 'object') return null;
  const blobs = Array.isArray(record.blobs) ? record.blobs : [];
  return {
    documentId: record.documentId != null ? String(record.documentId) : null,
    merkleRootHex: hex64(record.merkleRootHex),
    blobTotal: Number(record.blobTotal != null ? record.blobTotal : blobs.length) || blobs.length,
    chunkBytes: record.chunkBytes != null ? Number(record.chunkBytes) : null,
    sealed: record.sealed === true,
    size: record.size != null ? Number(record.size) : null,
    publisher: record.publisher ? String(record.publisher) : null,
    signature: record.signature ? String(record.signature) : null,
    blobs: blobs.map((b, i) => ({
      index: b && b.index != null ? Number(b.index) : i,
      blobHashHex: hex64(b && b.blobHashHex),
      paymentHashHex: hex64(b && (b.paymentHashHex || b.contentHashHex)),
      size: b && b.size != null ? Number(b.size) : null
    }))
  };
}

/**
 * Ranked offers for one blob (best first): score desc, latency+hops asc, price asc.
 * @param {Object[]} offers
 * @param {string} blobHashHex
 * @returns {Object[]}
 */
function offersForBlob (offers, blobHashHex) {
  const h = hex64(blobHashHex);
  if (!h) return [];
  return (Array.isArray(offers) ? offers : [])
    .filter((o) => o && hex64(o.blobHashHex) === h)
    .slice()
    .sort((a, b) => {
      const score = (Number(b.peerScore) || 0) - (Number(a.peerScore) || 0);
      if (score) return score;
      const la = (Number(a.latencyMs) || 0) + (Number(a.hops) || 0) * 50;
      const lb = (Number(b.latencyMs) || 0) + (Number(b.hops) || 0) * 50;
      if (la !== lb) return la - lb;
      return (Number(a.rateSats) || 0) - (Number(b.rateSats) || 0);
    });
}

/**
 * Resource id for a record: `documentId`, else the Tree root (hash-only
 * records may carry no id; `/documents/:id` accepts either).
 * @param {Object|null} doc sanitized record
 * @returns {string|null}
 */
function resourceId (doc) {
  if (!doc) return null;
  return doc.documentId || doc.merkleRootHex || null;
}

/**
 * Top three ranked providers for one blob.
 * @param {Object} leaf sanitized blob leaf
 * @param {Object[]} offers
 * @returns {string} HTML
 * @private
 */
function renderOffers (leaf, offers) {
  const ranked = offersForBlob(offers, leaf.blobHashHex);
  if (!ranked.length) return '<span class="ui tiny grey text">no providers yet</span>';
  return `<div class="ui mini horizontal list">${ranked.slice(0, 3).map((o) => {
    const who = escapeHtml(shortHex(o.sellerPubkey || o.ampSignerPubkey || o.sellerId || o.sellerAddress || 'peer'));
    const price = Number(o.rateSats) || 0;
    const lat = Number.isFinite(Number(o.latencyMs)) ? `${Math.round(Number(o.latencyMs))}ms` : '';
    return `<div class="item" data-seller="${escapeHtml(o.sellerId || '')}" data-blob-hash="${escapeHtml(leaf.blobHashHex)}">` +
      `<code>${who}</code> <span class="ui tiny label">${price === 0 ? 'free' : price + ' sats'}</span>` +
      (lat ? ` <span class="ui tiny grey text">${escapeHtml(lat)}</span>` : '') +
      '</div>';
  }).join('')}</div>`;
}

/**
 * Render a `fabric-document` state snapshot to HTML.
 * @param {Object} [state] `{ document, offers, opened }`
 * @param {Object} [options]
 * @param {string} [options.href='/documents'] resource list path
 * @param {string} [options.id] route id for the load button before a record is held
 * @returns {string} HTML
 */
function renderDocumentHTML (state = {}, options = {}) {
  const s = state || {};
  const href = options.href || '/documents';
  const doc = sanitizeRecord(s.document);
  const offers = Array.isArray(s.offers) ? s.offers : [];
  if (!doc) {
    const id = options.id ? String(options.id) : '';
    return `<div class="ui segment fabric-document">
      <div class="content"><code>${escapeHtml(href)}</code><button class="ui button" data-action="_loadDocument"${id ? ` data-document-id="${escapeHtml(id)}"` : ''}>load</button></div>
    </div>`;
  }
  const opened = s.opened || { manifest: null, blobs: {} };
  const openedBlobs = opened.blobs || {};
  const openedCount = Object.keys(openedBlobs).length;
  const manifest = opened.manifest && typeof opened.manifest === 'object' ? opened.manifest : null;
  const title = manifest && manifest.title ? escapeHtml(manifest.title) : null;

  let html = `<div class="ui segment fabric-document" data-merkle-root="${escapeHtml(doc.merkleRootHex || '')}">`;
  html += `<h3 class="ui header">${title || 'Document'} <span class="ui tiny grey text"><code>${escapeHtml(shortHex(doc.merkleRootHex))}</code></span></h3>`;
  html += '<div class="ui tiny horizontal list">';
  html += `<div class="item"><span class="ui label">${doc.sealed ? 'sealed' : 'plain'}</span></div>`;
  html += `<div class="item"><span class="ui label">${doc.blobTotal} blob${doc.blobTotal === 1 ? '' : 's'}</span></div>`;
  if (doc.size != null) html += `<div class="item"><span class="ui label">${escapeHtml(doc.size)} bytes</span></div>`;
  if (doc.publisher) html += `<div class="item">publisher <code>${escapeHtml(shortHex(doc.publisher))}</code></div>`;
  if (doc.sealed) html += `<div class="item">${openedCount}/${doc.blobTotal} opened</div>`;
  html += '</div>';
  if (manifest && manifest.url) {
    const link = safeHttpUrl(manifest.url);
    html += link
      ? `<p><a href="${escapeHtml(link)}" rel="noopener noreferrer">${escapeHtml(manifest.url)}</a></p>`
      : `<p><code>${escapeHtml(manifest.url)}</code></p>`;
  }
  html += '<table class="ui very compact small table"><thead><tr><th>#</th><th>blob hash</th><th>payment hash</th><th>providers</th><th></th></tr></thead><tbody>';
  for (const leaf of doc.blobs) {
    const isOpen = !!openedBlobs[leaf.index];
    html += `<tr data-blob-index="${leaf.index}">`;
    html += `<td>${leaf.index}</td>`;
    html += `<td><code title="${escapeHtml(leaf.blobHashHex || '')}">${escapeHtml(shortHex(leaf.blobHashHex))}</code></td>`;
    html += `<td><code title="${escapeHtml(leaf.paymentHashHex || '')}">${escapeHtml(shortHex(leaf.paymentHashHex))}</code></td>`;
    html += `<td>${renderOffers(leaf, offers)}</td>`;
    html += `<td>${isOpen
      ? '<i class="green unlock icon"></i>'
      : `<button class="ui mini button" data-action="_buyBlob" data-blob-index="${leaf.index}">buy</button>`}</td>`;
    html += '</tr>';
  }
  html += '</tbody></table>';
  html += '<div class="bottom attached content"><div class="ui action buttons">' +
    `<a class="ui button" href="${escapeHtml(href)}/${escapeHtml(encodeURIComponent(resourceId(doc) || ''))}"><i class="linkify icon"></i></a>` +
    '</div></div>';
  html += '</div>';
  return html;
}

module.exports = {
  sanitizeRecord,
  offersForBlob,
  resourceId,
  safeHttpUrl,
  renderDocumentHTML
};
