'use strict';

const FabricComponent = require('../types/component');

class Button extends FabricComponent {
  constructor (settings = {}) {
    super(settings);

    this.settings = Object.assign({
      handle: 'fabric-button'
    }, settings);

    this._state = {
      content: this.settings.state
    };

    return this;
  }
}

module.exports = Button;
