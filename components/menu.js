'use strict';

const Collection = require('./collection');

class Menu extends Collection {
  constructor (settings = {}) {
    super(settings);

    this.settings = Object.assign({
      handle: 'fabric-menu',
      path: '/resources'
    }, settings);

    this.items = [];

    return this;
  }

  _addItem (item) {
    return this.items.push(item);
  }

  render () {
    let html = `<${this.settings.handle} class="ui fixed inverted menu">
  <div class="ui container">`;

    for (let i = 0; i < this.items.length; i++) {
      let item = this.items[i];
      html += `<a href="${item.path}" class="item${(item.brand || false) ? ' brand' : ''}">${item.name}</a>`;
    }

    html += `  </div></${this.settings.handle}>`;

    return html;
  }
}

module.exports = Menu;
