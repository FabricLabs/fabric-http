'use strict';

const crypto = require('crypto');

class Component {
  constructor (settings = {}) {
    this.settings = Object.assign({
      handle: 'fabric-component',
      path: '/'
    }, settings);

    this.state = {};

    return this;
  }

  get data () {
    return JSON.stringify(this.state || {});
  }

  register () {
    customElements.define(this.settings.name, this.prototype);
  }

  render () {
    let content = `<code>${this.data}</code>`;
    let hash = crypto.createHash('sha256').update(content).digest('hex');
    return `<${this.settings.handle} data-integrity="sha256:${hash}">${content}</${this.settings.handle}>`;
  }
}

module.exports = Component;
