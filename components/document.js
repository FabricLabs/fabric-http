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
const { registerComponent } = require('../functions/componentCatalog');
const view = require('../functions/documentView');

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
    return view.sanitizeRecord(record);
  }

  /**
   * Ranked offers for one blob (best first): score desc, latency+hops asc, price asc.
   * @param {Object[]} offers
   * @param {string} blobHashHex
   * @returns {Object[]}
   */
  static offersForBlob (offers, blobHashHex) {
    return view.offersForBlob(offers, blobHashHex);
  }

  /**
   * Resource id for a record: `documentId`, else the Tree root (hash-only
   * records may carry no id; `/documents/:id` accepts either).
   * @param {Object|null} doc sanitized record
   * @returns {string|null}
   */
  static resourceId (doc) {
    return view.resourceId(doc);
  }

  /**
   * Id this handle was mounted for, before any record is loaded:
   * `settings.id`, else the last segment of the current `/documents/<id>` path.
   * @returns {string|null}
   */
  routeId () {
    if (this.settings.id) return String(this.settings.id);
    if (typeof window === 'undefined' || !window.location) return null;
    const base = String(this.settings.href || '/documents').replace(/\/$/, '');
    const path = String(window.location.pathname || '');
    if (!path.startsWith(base + '/')) return null;
    const rest = path.slice(base.length + 1).split('/')[0];
    try { return rest ? decodeURIComponent(rest) : null; } catch (_) { return null; }
  }

  /**
   * Fetch the record + offers for `/documents/:id` (client-side). Loading a
   * different document clears opened state and replaces offers outright.
   * @param {string} [id] defaults to the loaded record's id, then {@link FabricDocument#routeId}
   * @returns {Promise<Object|null>}
   */
  async _loadDocument (id) {
    const docId = id || FabricDocument.resourceId(this._view.document) || this.routeId();
    if (!docId || typeof fetch !== 'function') return null;
    const base = String(this.settings.href || '/documents').replace(/\/$/, '');
    const res = await fetch(`${base}/${encodeURIComponent(docId)}`, { headers: { Accept: 'application/json' } });
    if (!res || !res.ok) return null;
    const body = await res.json();
    const payload = body && body.data ? body.data : body;
    const next = FabricDocument.sanitizeRecord(payload && (payload.document || payload));
    const prevId = FabricDocument.resourceId(this._view.document);
    if (prevId !== FabricDocument.resourceId(next)) this._view.opened = null;
    this._view.document = next;
    this._view.offers = Array.isArray(payload && payload.offers) ? payload.offers : [];
    this.refresh();
    return this._view.document;
  }

  /**
   * Buy one blob: `GET` the blob path and expect the existing 402 payment
   * request (`X-Fabric-Payment-Request` with `documentOffer.blobHashHex`).
   * Settlement itself is the caller's (wallet) job; this surfaces the offer.
   * @param {number|string} index blob index (button `data-blob-index`)
   * @returns {Promise<Object|null>} parsed payment request object or null
   */
  async _buyBlob (index) {
    const doc = this._view.document;
    const leaf = doc && doc.blobs.find((b) => b.index === Number(index));
    const docId = FabricDocument.resourceId(doc);
    if (!leaf || !docId || typeof fetch !== 'function') return null;
    const base = String(this.settings.href || '/documents').replace(/\/$/, '');
    const res = await fetch(`${base}/${encodeURIComponent(docId)}/blobs/${leaf.index}`, {
      headers: { Accept: 'application/octet-stream' }
    });
    if (!res || res.status !== 402) return null;
    const header = res.headers && res.headers.get('X-Fabric-Payment-Request');
    if (!header) return null;
    let request;
    try {
      const { decodeFabricPaymentRequestHeaderValue } = require('../functions/fabricDocumentPayment402');
      const decoded = decodeFabricPaymentRequestHeaderValue(header);
      if (!decoded) return null;
      request = JSON.parse(decoded);
    } catch (_) {
      return null;
    }
    if (!request || typeof request !== 'object' || Array.isArray(request)) return null;
    this.emit('paymentRequest', { blobIndex: leaf.index, request });
    return request;
  }

  /**
   * Bind to the DOM element and handle this component's own `data-action`
   * buttons (the page-wide dispatcher only reaches Circuit methods and passes
   * no arguments): `_loadDocument` gets `data-document-id`, `_buyBlob` gets
   * `data-blob-index`.
   * @param {HTMLElement} element
   * @returns {FabricDocument}
   */
  _bind (element) {
    super._bind(element);
    if (this._onActionClick) element.removeEventListener('click', this._onActionClick);
    this._onActionClick = (event) => {
      const target = event && event.target && event.target.closest
        ? event.target.closest('[data-action]')
        : null;
      if (!target || !element.contains(target)) return;
      const action = target.getAttribute('data-action');
      if (action === '_loadDocument') {
        this._loadDocument(target.getAttribute('data-document-id') || undefined).catch((e) => this.emit('error', e));
      } else if (action === '_buyBlob') {
        this._buyBlob(target.getAttribute('data-blob-index')).catch((e) => this.emit('error', e));
      }
    };
    element.addEventListener('click', this._onActionClick);
    return this;
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

  /**
   * Render a state snapshot (`{ document, offers, opened }`); every field
   * shown is read from that snapshot, not from live view state.
   * @param {Object} [state]
   * @returns {string} HTML
   */
  _getInnerHTML (state) {
    return view.renderDocumentHTML(state || this._view || {}, { href: this.settings.href, id: this.settings.id });
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
