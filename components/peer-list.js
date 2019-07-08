'use strict';

const Component = require('./component');

class PeerList extends Component {
  constructor (settings = {}) {
    super(settings);
    this.settings = Object.assign({
      title: 'Peers',
      handle: 'fabric-peer-list'
    }, settings);

    this.state = {};

    return this;
  }

  _getInnerHTML () {
    return `<div class="ui segment">
      <h2>${this.settings.title}</h2>
      <maki-grid-view>
        <maki-grid-row>
          <maki-grid-column>
            <fabric-peer-table></fabric-peer-table>
          </maki-grid-column>
        </maki-grid-row>
      </maki-grid-view>
    </div>`;
  }

  render () {
    return `<${this.settings.handle}>${this._getInnerHTML()}</${this.settings.handle}>`;
  }
}

module.exports = PeerList;
