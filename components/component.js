'use strict';

const Fabric = require('@fabric/core');

const crypto = require('crypto');
const pointer = require('json-pointer');

/**
 * The {@link Component} element is a generic class for creating interactive DOM
 * elements, usually for later composition in an {@link App}.
 */
class Component extends HTMLElement {
  /**
   * Create a new {@link Fabric} {@link Component}.
   * @param  {Object} [settings={}] Settings for the {@link Component}.
   * @return {Component}               Instance of the {@link Component}.
   */
  constructor (settings = {}) {
    super(settings);

    this.settings = Object.assign({
      title: 'Fabric Component',
      handle: 'fabric-component'
    }, settings);

    this.element = document.createElement(this.settings.handle);
    this.fabric = new Fabric();
    this.remote = new Fabric.Remote({
      host: window.host,
      port: window.port
    });

    this.state = {
      methods: {},
      handlers: {}
    };

    return this;
  }

  get fingerprint () {
    return crypto.createHash('sha256').update(JSON.stringify(this.state)).digest('hex');
  }

  get title () {
    return this.settings.title;
  }

  get methods () {
    return Object.keys(this.state.methods);
  }

  attributeChangedCallback (name, old, value) {
    console.log('[MAKI:COMPONENT]', 'Component notified a change:', name, 'changed to:', value, `(was ${old})`);
  }

  connectedCallback () {
    console.log('[MAKI:COMPONENT]', 'Component added to page:', this);
    let html = this._getInnerHTML();

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
    // TODO: remove event listeners, close connections, etc.
  }

  _getElement () {
    return this.element;
  }

  _registerHandler (name, method) {
    this.state.handlers[name] = method.bind(this);

    switch (name) {
      case 'submit':
        let listener = document.addEventListener(name, method);
        console.log('listener created:', listener);
        break;
    }
  }

  _registerMethod (name, method) {
    this.state.methods[name] = method.bind(this);

    if (window && window.app && window.app.circuit) {
      window.app.circuit._registerMethod(name, this.state.methods[name]);
    }
  }

  _handleLocalChange (patches) {
    console.log('[MAKI:COMPONENT]', 'local changes:', patches);

    for (let i = 0; i < patches.length; i++) {
      let patch = patches[i];
      switch (patch.op) {
        case 'add':
        case 'replace':
          this.emit(patch.path, {
            '@type': 'Snapshot',
            '@data': patch.value
          });
          break;
      }
    }

    this.emit('/', {
      '@type': 'Snapshot',
      '@data': this.state
    });
  }

  /**
   * Re-draw the component, using provided state or existing state.
   * @param  {Object} [state={}] State to render with (optional).
   * @return {Component}         Instance of the {@link Component}.
   */
  _redraw (state = {}) {
    if (!state) state = this.state;
    console.log('[MAKI:COMPONENT]', 'redrawing with state:', state);
    this.innerHTML = this._getInnerHTML(state);
    console.log('this innerHTML', this.innerHTML);
    return this;
  }

  commit () {
    let id = this.fingerprint();
    return id;
  }

  _getInnerHTML (state) {
    if (!state) state = this.state;
    return `<code integrity="${this.integrity}">${JSON.stringify(this.state)}</code>`;
  }

  render () {
    return `<${this.settings.handle}>${this._getInnerHTML()}</${this.settings.handle}>`;
  }

  async _GET (path) {
    return pointer.get(this.state, path);
  }

  async _SET (path, value) {
    return pointer.set(this.state, path, value);
  }
}

module.exports = Component;
