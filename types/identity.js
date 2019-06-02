'use strict';

const Fabric = require('@fabric/core');

class Identity extends Fabric.Key {
  constructor (settings = {}) {
    super(settings);
    return this;
  }
}

module.exports = Identity;
