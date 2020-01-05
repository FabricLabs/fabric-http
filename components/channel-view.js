'use strict';

const Component = require('./component');

class ChannelView extends Component {
  constructor (settings = {}) {
    super(settings);

    this.settings = Object.assign({
      title: 'Channel View',
      handle: 'fabric-channel-view'
    }, settings);

    this.channels = [];
    this.state = { channels: this.channels };

    return this;
  }

  _getInnerHTML () {
    let html = `<div class="ui segment">`;
    html += '<h3>Single Channel</h3>';
    html += '</div>';
    return html;
  }
}

module.exports = ChannelView;
