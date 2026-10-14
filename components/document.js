'use strict';

/**
 * @fileoverview `fabric-document` — the user-facing presentation of a core
 * `Document` (sealed blob tree). Renders the **hash-only record** (Tree root,
 * blob leaves, publisher key) plus ranked provider offers from a local
 * `DocumentOfferBook`, a buy action per blob (existing HTTP 402 flow:
 * `functions/fabricDocumentPayment402.js` carries `blobHashHex`), and — only
 * client-side, once keys are held — the opened manifest / content.
 *
 * Server-rendered output never contains names, titles, URLs, or bytes.
 *
 * Core `Document#compile([env, 'fabric-document'])` emits
 * `extends env / block body / fabric-document(state="<id>") {{state}}`; this
 * handle is what that fragment binds to.
 */

const Component = require('../types/component');
const { registerComponent, escapeHtml } = require('../functions/componentCatalog');

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

class FabricDocument extends Component {
  /**
   * @param {Object} [settings]
   * @param {string} [settings.href='/documents'] Resource list path.
   * @param {Object} [settings.document] Hash-only record (`Document#record()`).
   * @param {Object[]} [settings.offers] Rows from `DocumentOfferBook#listOffers`.
   * @param {Object} [settings.opened] `{ manifest, blobs: { [index]: true } }` — client-side only.
   */
  constructor (settings = {}) {
    super(settings);
    this.settings = Object.assign({
      href: '/documents',
      handle: 'fabric-document',
      path: '/documents/:id',
      document: null,
      offers: [],
      opened: null
    }, settings);
    this._state.content = {
      document: this.settings.document,
      offers: Array.isArray(this.settings.offers) ? this.settings.offers : [],
      opened: this.settings.opened || null
    };
    return this;
  }

  /** Mutable view state (`Service#state` returns a copy). @private */
  get _view () {
    if (!this._state.content || typeof this._state.content !== 'object') this._state.content = {};
    return this._state.content;
  }

  /**
   * Keep only hash / key / signature fields from whatever record arrives.
   * @param {Object} record
   * @returns {Object|null}
   */
  static sanitizeRecord (record) {
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
  static offersForBlob (offers, blobHashHex) {
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
   * Fetch the record + offers for `/documents/:id` (client-side).
   * @param {string} [id]
   * @returns {Promise<Object|null>}
   */
  async _loadDocument (id) {
    const docId = id || (this._view.document && this._view.document.documentId);
    if (!docId || typeof fetch !== 'function') return null;
    const base = String(this.settings.href || '/documents').replace(/\/$/, '');
    const res = await fetch(`${base}/${encodeURIComponent(docId)}`, { headers: { Accept: 'application/json' } });
    if (!res || !res.ok) return null;
    const body = await res.json();
    const payload = body && body.data ? body.data : body;
    this._view.document = FabricDocument.sanitizeRecord(payload && (payload.document || payload));
    this._view.offers = Array.isArray(payload && payload.offers) ? payload.offers : this._view.offers;
    this.refresh();
    return this._view.document;
  }

  /**
   * Buy one blob: `GET` the blob path and expect the existing 402 payment
   * request (`X-Fabric-Payment-Request` with `documentOffer.blobHashHex`).
   * Settlement itself is the caller's (wallet) job; this surfaces the offer.
   * @param {number} index
   * @returns {Promise<Object|null>} decoded payment request header or null
   */
  async _buyBlob (index) {
    const doc = this._view.document;
    const leaf = doc && doc.blobs.find((b) => b.index === Number(index));
    if (!leaf || typeof fetch !== 'function') return null;
    const base = String(this.settings.href || '/documents').replace(/\/$/, '');
    const res = await fetch(`${base}/${encodeURIComponent(doc.documentId)}/blobs/${leaf.index}`, {
      headers: { Accept: 'application/octet-stream' }
    });
    if (res && res.status === 402) {
      const header = res.headers && res.headers.get('X-Fabric-Payment-Request');
      if (!header) return null;
      try {
        const { decodeFabricPaymentRequestHeaderValue } = require('../functions/fabricDocumentPayment402');
        const decoded = decodeFabricPaymentRequestHeaderValue(header);
        this.emit('paymentRequest', { blobIndex: leaf.index, request: decoded });
        return decoded;
      } catch (_) {
        return null;
      }
    }
    return null;
  }

  /**
   * Mark blobs opened (keys held) and optionally attach the decoded manifest —
   * called by the embedding app after `Document#openBlob` succeeds.
   * @param {Object} opened `{ manifest?, blobs?: number[] }`
   */
  _setOpened (opened = {}) {
    const prev = this._view.opened || { manifest: null, blobs: {} };
    const blobs = Object.assign({}, prev.blobs);
    for (const i of (Array.isArray(opened.blobs) ? opened.blobs : [])) blobs[Number(i)] = true;
    this._view.opened = {
      manifest: opened.manifest || prev.manifest || null,
      blobs
    };
    this.refresh();
  }

  _renderOffers (leaf) {
    const offers = FabricDocument.offersForBlob(this._view.offers, leaf.blobHashHex);
    if (!offers.length) return '<span class="ui tiny grey text">no providers yet</span>';
    return `<div class="ui mini horizontal list">${offers.slice(0, 3).map((o) => {
      const who = escapeHtml(shortHex(o.sellerPubkey || o.ampSignerPubkey || o.sellerId || o.sellerAddress || 'peer'));
      const price = Number(o.rateSats) || 0;
      const lat = Number.isFinite(Number(o.latencyMs)) ? `${Math.round(Number(o.latencyMs))}ms` : '';
      return `<div class="item" data-seller="${escapeHtml(o.sellerId || '')}" data-blob-hash="${escapeHtml(leaf.blobHashHex)}">` +
        `<code>${who}</code> <span class="ui tiny label">${price === 0 ? 'free' : price + ' sats'}</span>` +
        (lat ? ` <span class="ui tiny grey text">${escapeHtml(lat)}</span>` : '') +
        `</div>`;
    }).join('')}</div>`;
  }

  _getInnerHTML (state) {
    const s = state || this._view || {};
    const doc = FabricDocument.sanitizeRecord(s.document);
    if (!doc) {
      return `<div class="ui segment fabric-document">
      <div class="content"><code>${escapeHtml(this.settings.href)}</code><button class="ui button" data-action="_loadDocument">load</button></div>
    </div>`;
    }
    const opened = s.opened || { manifest: null, blobs: {} };
    const openedCount = Object.keys(opened.blobs || {}).length;
    const manifest = opened.manifest && typeof opened.manifest === 'object' ? opened.manifest : null;
    const title = manifest && manifest.title ? escapeHtml(manifest.title) : null;

    let html = `<div class="ui segment fabric-document" data-merkle-root="${escapeHtml(doc.merkleRootHex || '')}">`;
    html += `<h3 class="ui header">${title || 'Document'} <span class="ui tiny grey text"><code>${escapeHtml(shortHex(doc.merkleRootHex))}</code></span></h3>`;
    html += `<div class="ui tiny horizontal list">`;
    html += `<div class="item"><span class="ui label">${doc.sealed ? 'sealed' : 'plain'}</span></div>`;
    html += `<div class="item"><span class="ui label">${doc.blobTotal} blob${doc.blobTotal === 1 ? '' : 's'}</span></div>`;
    if (doc.size != null) html += `<div class="item"><span class="ui label">${escapeHtml(doc.size)} bytes</span></div>`;
    if (doc.publisher) html += `<div class="item">publisher <code>${escapeHtml(shortHex(doc.publisher))}</code></div>`;
    if (doc.sealed) html += `<div class="item">${openedCount}/${doc.blobTotal} opened</div>`;
    html += `</div>`;
    if (manifest && manifest.url) html += `<p><a href="${escapeHtml(manifest.url)}" rel="noopener noreferrer">${escapeHtml(manifest.url)}</a></p>`;
    html += `<table class="ui very compact small table"><thead><tr><th>#</th><th>blob hash</th><th>payment hash</th><th>providers</th><th></th></tr></thead><tbody>`;
    for (const leaf of doc.blobs) {
      const isOpen = !!opened.blobs[leaf.index];
      html += `<tr data-blob-index="${leaf.index}">`;
      html += `<td>${leaf.index}</td>`;
      html += `<td><code title="${escapeHtml(leaf.blobHashHex || '')}">${escapeHtml(shortHex(leaf.blobHashHex))}</code></td>`;
      html += `<td><code title="${escapeHtml(leaf.paymentHashHex || '')}">${escapeHtml(shortHex(leaf.paymentHashHex))}</code></td>`;
      html += `<td>${this._renderOffers(leaf)}</td>`;
      html += `<td>${isOpen
        ? '<i class="green unlock icon"></i>'
        : `<button class="ui mini button" data-action="_buyBlob" data-blob-index="${leaf.index}">buy</button>`}</td>`;
      html += `</tr>`;
    }
    html += `</tbody></table>`;
    html += `<div class="bottom attached content"><div class="ui action buttons">` +
      `<a class="ui button" href="${escapeHtml(this.settings.href)}/${escapeHtml(encodeURIComponent(doc.documentId || doc.merkleRootHex || ''))}"><i class="linkify icon"></i></a>` +
      `</div></div>`;
    html += `</div>`;
    return html;
  }
}

/**
 * Reference `Document` resource for `Server.define('Document', FabricDocument.resource)`:
 * `/documents` lists hash-only records, `/documents/:id` renders this handle.
 */
FabricDocument.resource = Object.freeze({
  routes: Object.freeze({ list: '/documents', view: '/documents/:id' }),
  components: Object.freeze({ list: 'fabric-resource-list', view: 'fabric-document' })
});

registerComponent(FabricDocument, 'fabric-document', {
  handle: 'fabric-document',
  path: '/documents/:id'
});

module.exports = FabricDocument;
