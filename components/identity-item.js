'use strict';

const Component = require('../types/component');
const Identity = require('../types/identity');

class IdentityItem extends Component {
  constructor (settings = {}) {
    super(settings);
    this.identity = new Identity(this.settings);
    return this;
  }

  render () {
    return `<identity-item class="item" integrity="${this.identity.integrity}">${this.identity.render()}</identity-item>`;
  }
}

module.exports = IdentityItem;
