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

  _getInnerHTML () {
    const label = this.settings.label || this.settings.title || 'Submit';
    return '<button type="submit" class="ui button">' + escapeHtml(label) + '</button>';
  }
}

const { escapeHtml, registerComponent } = require('../functions/componentCatalog');

registerComponent(Button, 'fabric-button', {
  handle: 'fabric-button',
  label: 'Submit'
});

module.exports = Button;
