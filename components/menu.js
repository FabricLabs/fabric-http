'use strict';

const Identity = require('../types/identity');

const Collection = require('./collection');
const IdentityItem = require('./identity-item');

class Menu extends Collection {
  constructor (settings = {}) {
    super(settings);

    this.settings = Object.assign({
      handle: 'fabric-menu',
      path: '/resources'
    }, settings);

    this.items = [];
    this.identity = null;
    this.indicator = null;

    return this;
  }

  _addItem (item) {
    return this.items.push(item);
  }

  _attachIdentity (identity) {
    this.identity = new Identity(identity);
    this.indicator = new IdentityItem(identity);
    this.emit('update');
  }

  render () {
    let html = `<${this.settings.handle} class="ui fixed inverted menu">
  <div class="ui container">`;

    for (let i = 0; i < this.items.length; i++) {
      let item = this.items[i];
      html += `<a href="${item.path}" class="item${(item.brand || false) ? ' brand' : ''}">${item.name}</a>`;
    }

    if (this.indicator) {
      html += `<div class="right menu">${this.indicator.render()}</div>`;
    }

    html += `  </div></${this.settings.handle}>`;

    return html;
  }
}

module.exports = Menu;
