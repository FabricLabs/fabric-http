'use strict';

const FabricComponent = require('../types/component');
const { escapeHtml, registerComponent } = require('../functions/componentCatalog');

/**
 * Message history. The same region as `box#history` on the CLI reference.
 */
class History extends FabricComponent {
  constructor (settings = {}) {
    super(settings);

    this.settings = Object.assign({
      handle: 'fabric-message-list',
      title: 'History'
    }, settings);

    return this;
  }

  _getInnerHTML (state) {
    const source = state || this.state || {};
    const messages = Array.isArray(source.messages) ? source.messages : [];
    const items = messages.map((line) => '<li>' + escapeHtml(line) + '</li>').join('');
    return '<div class="ui segment"><h2>' + escapeHtml(this.settings.title) + '</h2><ul>' + items + '</ul></div>';
  }
}

registerComponent(History, 'fabric-message-list', {
  handle: 'fabric-message-list',
  title: 'History'
});

module.exports = History;
