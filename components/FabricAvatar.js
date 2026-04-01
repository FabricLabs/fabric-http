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

    const avatar = new Avatar(identity, { size });
    const html = avatar.render({ format, className, alt: 'Fabric Avatar' });
    if (this.shadowRoot) this.shadowRoot.innerHTML = html;
  }
}

module.exports = FabricAvatar;
