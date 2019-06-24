'use strict';

// const Component = require('./component');

class Introduction {
  constructor (settings = {}) {
    // super(settings);

    this.settings = Object.assign({
      title: 'Introduction to Maki, a cross-platform UI designer'
    }, settings);

    return this;
  }

  render () {
    return `<fabric-introduction>
      <h3>${this.settings.title}</h3>
      <p>Welcome to Fabric, friend.</p>
      <h4>Help Wanted</h4>
      <p>Curious adventurers inquire within.</p>
    </fabric-introduction>`;
  }
}

module.exports = Introduction;
