'use strict';

const Key = require('@fabric/core/types/key');

class Identity extends Key {
  constructor (settings = {}) {
    super(settings);
    return this;
  }
}

module.exports = Identity;
