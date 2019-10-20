'use strict';

const Component = require('../types/component');
// const Collection = require('@fabric/core/types/collection');

class Sidebar extends Component {
  constructor (settings = {}) {
    super(settings);

    this.settings = Object.assign({
      handle: 'maki-sidebar',
      items: []
    }, settings);

    // this.resources = new Collection();
    this.state = { items: this.settings.items };

    return this;
  }

  connectedCallback () {
    super.connectedCallback();
  }

  _addItem (item) {
    if (!item || !item.name) return false;
    this.state.items.push(item);
    return true;
  }

  _getInnerHTML () {
    let html = ``;
    html += `<div class="ui right fixed vertical inverted menu">`;

    if (this.settings.branded) {
      for (let i = 0; i < this.state.items.length; i++) {
        let item = this.state.items[i];
        if (i === 0) {
          html += `<div class="centered brand item"><a href="${item.link}" class="ui tiny circular image"><img src="/images/brand.png" /></a><a href="${item.link}"><div class="ui inverted header">${item.name}</div><div><small><strong>Version:</strong> <code>${this.version}</code></small></div></a></div>`;
        }
      }
    }

    html += `<div class="item">`;
    html += `<maki-identity-card />`;
    html += `</div>`;

    html += `<div class="item">`;
    html += `<strong>Resources</strong>`;
    html += `<div class="menu">`;
    for (let i = 0; i < this.state.items.length; i++) {
      let item = this.state.items[i];
      if (i !== 0) {
        html += `<div class="item"><a href="${item.link}">${(item.icon) ? '<i class="'+item.icon+' icon"></i> ' : ''}${item.name}</a></div>`;
      }
    }
    html += `</div>`;
    html += `</div>`;
    html += `</div>`;
    return html;
  }
}

module.exports = Sidebar;
