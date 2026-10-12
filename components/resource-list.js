'use strict';

const Component = require('../types/component');
const Collection = require('./collection');
const Resource = require('@fabric/core/types/resource');

class ResourceList extends Component {
  constructor (settings = {}) {
    super(settings);

    this.settings = Object.assign({
      handle: 'fabric-resource-list',
      path: '/resources'
    }, settings);

    return this;
  }

  _getInnerHTML () {
    return `<strong>Resource list here...`;
  }
}

const { registerComponent } = require('../functions/componentCatalog');

registerComponent(ResourceList, 'fabric-resource-list', {
  handle: 'fabric-resource-list',
  path: '/resources'
});

module.exports = ResourceList;
