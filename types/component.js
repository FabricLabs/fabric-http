'use strict';

// Dependencies
const crypto = require('crypto');
const Service = require('@fabric/core/types/service');
// const Fabric = require('@fabric/core');

/**
 * Generic component.
 */
class FabricComponent extends Service {
  /**
   * Create a component.
   * @param  {Object} [settings={}] Settings for the component.
   * @return {Component}            Fully-configured component.
   */
  constructor (settings = {}) {
    super(settings);

    this.settings = Object.assign({
      handle: 'fabric-component',
      path: '/'
    }, settings);

    this.element = null;

    // Healthy Cleanup
    this._boundFunctions = {};
    this._listeners = {};

    this._state = {
      content: settings
    };

    return this;
  }

  get path () {
    return this.settings.path;
  }

  get data () {
    return JSON.stringify(this.state || {});
  }

  get hash () {
    // TODO: cache and skip
    return crypto.createHash('sha256').update(this.render()).digest('hex');
  }

  get integrity () {
    // TODO: cache and skip
    let hash = crypto.createHash('sha256').update(this.data).digest('base64');
    return `sha256-${hash}`;
  }

  attributeChangedCallback (name, old, value) {
    console.log('[MAKI:COMPONENT]', 'Component notified a change:', name, 'changed to:', value, `(was ${old})`);
  }

  connectedCallback () {
    console.log('[MAKI:COMPONENT]', 'Component added to page:', this);
    let html = this._getInnerHTML(this.state);

    this.setAttribute('data-integrity', Fabric.sha256(html));
    this.setAttribute('data-fingerprint', this.fingerprint);
    // this.innerHTML = html;
    this.innerHTML = html + '';

    /* let binding = this.getAttribute('data-bind');

    if (binding) {
      // TODO: use Fabric.Remote
      fetch(`fabric:${binding}`)
        .then((response) => response.text())
        .then((responseText) => {
          this.render(JSON.parse(responseText));
        })
        .catch((error) => {
          console.error(error);
        });
    } */

    // Reflect.construct(HTMLElement, [], this.constructor);
    return this;
  }

  disconnectedCallback () {
    console.log('[MAKI:COMPONENT]', 'Component removed from page:', this);

    for (let name in this._boundFunctions) {
      this.removeEventListener('message', this._boundFunctions[name]);
    }
  }

  _bind (element) {
    if (this.element) {
      // TODO: unbind old handlers
    }

    this.element = element;
    this.element.addEventListener('refresh', this.refresh.bind(this));
    this.element.addEventListener('message', this._handleComponentMessage.bind(this));

    this.render();

    return this;
  }

  _handleComponentMessage (msg) {
    console.log('[FABRIC:COMPONENT]', 'Element emitted message:', msg);
  }

  _toElement () {
    let element = document.createElement(this.settings.handle);
    element.innerHTML = this._getInnerHTML(this.state);
    return element;
  }

  /**
   * Load an HTML string into the Component.
   * @param {String} [content] HTML string to load (empty by default).
   * @returns {String} HTML document.
   */
  _loadHTML (content = '') {
    let hash = crypto.createHash('sha256').update(content).digest('base64');
    return `<${this.settings.handle} integrity="sha256-${hash}">${content}</${this.settings.handle}>`;
  }

  _getInnerHTML (state) {
    return `<code class="unconfigured" data-name="_getInnerHTML">${JSON.stringify(state || this.state)}</code>`;
  }

  _renderState (state) {
    // TODO: render Template here
    // cc: @melnx @lel @lllllll:fabric.pub
    const content = this._getInnerHTML(state);
    return this._loadHTML(content);
  }

  refresh () {
    if (this.element) {
      this.element.innerHTML = this._getInnerHTML(this.state);
    }
  }

  register () {
    customElements.define(this.settings.handle, Component, { extends: 'div' });
  }

  render () {
    if (this.element) this.element.innerHTML = this._getInnerHTML();
    return this._renderState(this.state);
  }

  toHTML () {
    return this._renderState(this.state);
  }
}

module.exports = FabricComponent;

// TODO: debug why this can't be used on this parent class...
// ```
// TypeError: Class extends value #<Object> is not a constructor or null
// Module.<anonymous>
// src/components/FabricIdentityManager.js:19
//   16 | import IdentityPicker from './IdentityPicker';
//   17 | import SeedEntryForm from './SeedEntryForm';
//   18 | 
// > 19 | class FabricIdentityManager extends FabricComponent {
//   20 |   constructor (props) {
//   21 |     super(props);
//   22 | 
// ```
// export default connect(FabricStateMapper)(FabricComponent);
//
// ...
// End of @fabric/core/types/component
