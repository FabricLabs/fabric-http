'use strict';

const crypto = require('crypto');
const Fabric = require('@fabric/core');

/**
 * Generic component.
 */
class Component extends Fabric.State {
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

  render () {
    let content = `<code integrity="${this.integrity}">${this.data}</code>`;
    let hash = crypto.createHash('sha256').update(content).digest('base64');
    return `<${this.settings.handle} integrity="sha256-${hash}">${content}</${this.settings.handle}>`;
  }
}

module.exports = Component;
