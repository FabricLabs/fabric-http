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

module.exports = ResourceList;
