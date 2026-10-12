'use strict';

const FabricComponent = require('../types/component');
const { escapeHtml, registerComponent } = require('../functions/componentCatalog');

/**
 * Log pane. The same region as `box#logs` on the CLI reference.
 */
class LogList extends FabricComponent {
  constructor (settings = {}) {
    super(settings);

    this.settings = Object.assign({
      handle: 'fabric-log-list',
      title: 'Logs'
    }, settings);

    return this;
  }

  _getInnerHTML (state) {
    const source = state || this.state || {};
    const logs = Array.isArray(source.logs) ? source.logs : [];
    const items = logs.map((line) => '<li>' + escapeHtml(line) + '</li>').join('');
    return '<div class="ui segment"><h2>' + escapeHtml(this.settings.title) + '</h2><ul>' + items + '</ul></div>';
  }
}

registerComponent(LogList, 'fabric-log-list', {
  handle: 'fabric-log-list',
  title: 'Logs'
});

module.exports = LogList;
