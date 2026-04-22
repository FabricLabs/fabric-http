'use strict';

const Avatar = require('../types/avatar');

const BaseElement = (typeof HTMLElement === 'undefined') ? class {} : HTMLElement;

/**
 * Tiny custom-element wrapper for deterministic Fabric avatars.
 *
 * Usage:
 *   <fabric-avatar identity="did:fabric:abc123" size="96"></fabric-avatar>
 */
class FabricAvatar extends BaseElement {
  static get observedAttributes () {
    return ['identity', 'size', 'format', 'class'];
  }

  constructor () {
    super();
    if (typeof this.attachShadow === 'function') this.attachShadow({ mode: 'open' });
  }

  connectedCallback () {
    this._render();
  }

  attributeChangedCallback () {
    this._render();
  }

  _render () {
    const identity = this.getAttribute('identity') || this.textContent || '';
    const size = parseInt(this.getAttribute('size') || '64', 10);
    const format = this.getAttribute('format') || 'img';
    const className = this.getAttribute('class') || 'fabric-avatar';
    const safeSize = Number.isFinite(size) && size > 0 ? size : 64;
    const safeClassName = String(className).replace(/[^a-zA-Z0-9 _-]/g, '').trim() || 'fabric-avatar';

    const avatar = new Avatar(identity, { size: safeSize });
    if (!this.shadowRoot) return;

    if (format === 'svg') {
      const hostDoc = this.ownerDocument || (typeof document !== 'undefined' ? document : null);
      if (!hostDoc) return;
      const parser = new hostDoc.defaultView.DOMParser();
      const svgDoc = parser.parseFromString(avatar.toSVG(), 'image/svg+xml');
      const svgEl = svgDoc.documentElement;
      const imported = hostDoc.importNode(svgEl, true);
      this.shadowRoot.replaceChildren(imported);
      return;
    }

    const hostDoc = this.ownerDocument || (typeof document !== 'undefined' ? document : null);
    if (!hostDoc) return;
    const img = hostDoc.createElement('img');
    img.setAttribute('class', safeClassName);
    img.setAttribute('src', avatar.toDataURI());
    img.setAttribute('alt', 'Fabric Avatar');
    this.shadowRoot.replaceChildren(img);
  }
}

module.exports = FabricAvatar;
