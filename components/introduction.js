'use strict';

class Introduction {
  constructor (settings = {}) {
    this.settings = Object.assign({}, settings);
  }

  render () {
    return `<fabric-introduction>
      <h3>Introduction></h3>
      <p>Welcome to Fabric, friend.</p>
    </fabric-introduction>`;
  }
}

module.exports = Introduction;
