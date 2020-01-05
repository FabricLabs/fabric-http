'use strict';

const $ = require('jquery');

class SearchBox {
  constructor (settings = {}) {
    this.settings = Object.assign({}, settings);
    return this;
  }

  start () {
    console.log('[MAKI:SEARCH]', 'starting...');

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
