'use strict';

const Component = require('./component');

class Channel extends Component {
  constructor (settings = {}) {
    super(settings);

    this.settings = Object.assign({
      reconnect: true
    }, settings);

    return this;
  }

  render () {
    return `<fabric-channel></fabric-channel>`;
  }
}

module.exports = Channel;
