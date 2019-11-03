'use strict';

const crypto = require('crypto');
const Service = require('@fabric/core/types/service');
// const Fabric = require('@fabric/core');

/**
 * Generic component.
 */
class Component extends Service {
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

    this.state = settings;
    this.element = null;

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

  _bind (element) {
    if (this.element) {
      // TODO: unbind old handlers
    }

    this.element = element;
    this.element.addEventListener('refresh', this.refresh.bind(this));

    this.render();

    return this;
  }

  _toElement () {
    let element = document.createElement(this.settings.handle);
    element.innerHTML = this._getInnerHTML(this.state);
    return element;
  }

  _loadHTML (content) {
    let hash = crypto.createHash('sha256').update(content).digest('base64');
    return `<${this.settings.handle} integrity="sha256-${hash}">${content}</${this.settings.handle}>`;
  }

  _getInnerHTML (state) {
    return `<code class="unconfigured" data-name="_getInnerHTML">${JSON.stringify(state || this.state)}</code>`;
  }

  _renderState (state) {
    // TODO: render Template here
    // cc: @melnx @lel @lllllll:fabric.pub
    let content = this._getInnerHTML(state);
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
    this.element.innerHTML = this._getInnerHTML();
    return this._renderState(this.state);
  }
}

module.exports = Component;
