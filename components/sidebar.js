'use strict';

const Component = require('./component');

class Sidebar extends Component {
  constructor (settings = {}) {
    super(settings);
    this.settings = Object.assign({}, settings);
    return this;
  }

  connectedCallback () {
    super.connectedCallback();
  }
}

module.exports = Sidebar;
