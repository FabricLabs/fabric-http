'use strict';

const defaults = require('./default');

module.exports = {
  ...defaults,
  resources: {
    'Contract': {
      fields: [
        { name: 'id', type: 'String', required: true },
        { name: 'created', type: 'String', required: true },
        { name: 'definition', type: 'String', required: true },
        { name: 'author', type: 'String', required: true }
      ]
    },
    'Example': {
      fields: [
        { name: 'name', type: 'String' }
      ]
    }
  },
};
