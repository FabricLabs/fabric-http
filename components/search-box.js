'use strict';

class SearchBox {
  constructor (settings = {}) {
    this.settings = Object.assign({}, settings);
    return this;
  }

  start () {
    console.log('[MAKI:SEARCH]', 'starting...');

    // jQuery 4 throws when required without a window, so load it only here.
    const $ = require('jquery');
    $('.ui.search').search({
      apiSettings: {
        url: '/searches/{query}'
      },
      type: 'category'
    });

    return this;
  }

  render () {
    return `<div>FakeSearchBox</div>`;
  }
}

module.exports = SearchBox;
