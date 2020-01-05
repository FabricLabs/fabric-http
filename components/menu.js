'use strict';

const Identity = require('../types/identity');

const Collection = require('./collection');
const IdentityItem = require('./identity-item');
// const Wallet = require('./wallet');

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
    // this.wallet = new Wallet();

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

  _getInnerHTML () {
    return `<div>fake menu</div>`;
  }

  render () {
    let html = `<${this.settings.handle} class="ui fixed inverted menu">
      <div class="ui container">`;

    for (let i = 0; i < this.items.length; i++) {
      let item = this.items[i];

      html += `<a href="${item.path}" title="${item.description || ''}" class="tooltipped item${(item.brand || false) ? ' brand' : ''}">`;

      if (item.icon) {
        html += `<i class="${item.icon} icon"></i>`;
      }

      html += `${item.name}${(this.settings.label) ? ' <span class="ui tiny label">' + this.settings.label + '</span>' : ''}</a>`;
    }

    html += `<div class="right menu" id="identity-menu">`;
    html += `<fabric-wallet-card class="item"></fabric-wallet-card>`;

    if (this.indicator) {
      html += `<div>${this.indicator.render()}</div>`;
    }
    html += `</div>`;

    html += `</div></${this.settings.handle}>`;

    return html;
  }
}

module.exports = Menu;
