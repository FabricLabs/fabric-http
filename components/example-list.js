'use strict';

class ExampleList {
  constructor (settings = {}) {
    this.config = settings;
    this.tag = `maki-example-list`;
  }

  render () {
    return `<${this.config.tag}><ul><li>First list item!</ul></${this.config.tag}>`;
  }
}

module.exports = ExampleList;
