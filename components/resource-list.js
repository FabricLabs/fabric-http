'use strict';

const Collection = require('./collection');
const Resource = require('@fabric/core/lib/resource');

class ResourceList extends Collection {
  constructor (settings = {}) {
    super(settings);

    this.settings = Object.assign({
      handle: 'fabric-resource-list',
      path: '/resources'
    }, settings);

    return this;
  }

  render () {
    let html = `<${this.settings.handle}>`;

    for (let name in this.state) {
      let template = this.state[name];
      let resource = new Resource(template);
      html += resource.render();
    }

    html += `</${this.settings.handle}>`;

    return html;
  }
}

module.exports = ResourceList;
