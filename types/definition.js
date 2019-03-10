'use strict';

const pluralize = require('plural');

/**
 * @class Definition
 * @type {Object}
 * @property {String} name Human-friendly name for this type.
 * @property {String} name Human-friendly plural name for this type.
 * @property {Object} routes Path hint for retrieving an index.
 * @property {String} routes.list Path hint for retrieving an index.
 * @property {String} routes.view Path hint for retrieving a single entity.
 */
class Definition {
  constructor (options = {}) {
    this.name = options.name || 'Type';
    this.plural = pluralize(this.name);
    this.routes = {
      'list': `/${this.plural.toLowerCase()}`,
      'view': `/${this.plural.toLowerCase()}/:id`
    };
  }
}

module.exports = Definition;
