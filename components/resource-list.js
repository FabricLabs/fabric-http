'use strict';

const Collection = require('./collection');

class ResourceList extends Collection {
  constructor (settings = {}) {
    super(settings);

    this.settings = Object.assign({
      handle: 'fabric-resource-list',
      path: '/resources'
    });

    return this;
  }

  render () {
    let html = `<${this.settings.handle}>`;

    for (let name in this.state) {
      let Resource = this.state[name];
      console.log('resource:', name, Resource);
      console.log('state:', this.state);
      let instance = new Resource({
        name: name,
        handle: name,
        definition: Resource
      });
      html += `<${instance.handle} name="${name}">${instance.render()}</${instance.handle}>`;
    }

    html += `</${this.settings.handle}>`;

    return html;
  }
}

module.exports = ResourceList;
