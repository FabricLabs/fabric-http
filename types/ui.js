'use strict';

const Actor = require('@fabric/core/types/actor');

/**
 * User Interface for a Fabric Actor.
 */
class UI extends Actor {
  constructor (input = {}) {
    super(input);

    // Default Settings
    this.settings = Object.assign({
      browser: null,
      dom: null,
      window: null
    }, input);

    // Apply State
    this._state = {
      content: {
        browser: this.settings.browser,
        dom: this.settings.dom,
        window: this.settings.window
      },
      status: 'READY'
    };

    return this;
  }

  _toSerializedJSON (state) {
    return JSON.stringify(state);
  }

  _renderHTML (state = this.state) {
    // Worst-case scenario
    return `<fabric-user-interface state-json="${this._toSerializedJSON(state)}" />`;
  }

  render (state = this.state) {
    const format = 'html';
    switch (format) {
      case 'html':
      default:
        return this._renderHTML(state);
    }
  }
}

module.exports = UI;
