'use strict';

const Component = require('./component');

class CircuitView extends Component {
  constructor (settings = {}) {
    super(settings);

    this.settings = Object.assign({
      name: 'Circuit Inspector',
      description: 'Viewing a single Fabric Circuit.',
      handle: 'fabric-circuit-view'
    }, settings);

    return this;
  }

  _getInnerHTML () {
    let html = ``;
    html += `<fabric-grid-row class="ui segment">
      <h3>Circuit #${this.id}<h3>
    </fabric-grid-row>`;
    html += ``;
    return html;
  }
}

module.exports = CircuitView;
