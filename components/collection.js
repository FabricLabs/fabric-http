'use strict';

const Component = require('../types/component');

class Collection extends Component {
  constructor (settings = {}) {
    super(settings);

    this.settings = Object.assign({
      handle: 'fabric-collection',
      items: 'item',
      path: '/collections/:id'
    }, settings);

    return this;
  }

  render () {
    let html = `<${this.settings.handle}>`;

    for (let name in this.state) {
      let definition = this.state[name];
      html += `<${definition.handle} name="${name}"><!-- ${definition.toString()} --></${definition.handle}>`;
    }

    html += `</${this.settings.handle}>`;

    return html;
  }
}

module.exports = Collection;
