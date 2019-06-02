'use strict';

const Fabric = require('@fabric/core');

/**
 * Generic interface for collections of digital objects.
 * @param       {Object} definition Initial parameters
 * @constructor
 */
class Resource extends Fabric.Resource {
  constructor (definition = {}) {
    super(definition);
    this.components = {};
    return this;
  }

  _define (name, definition) {
    this.components[name] = definition;
    return this;
  }

  renderComponent (name) {
    return this.components[name].render();
  }

  render () {
    return `<fabric-resource name="${this.name}"><code>${JSON.stringify(this.definition)}</code></fabric-resource>`;
  }
}

module.exports = Resource;
