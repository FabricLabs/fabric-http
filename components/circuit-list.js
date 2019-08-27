'use strict';

const Component = require('./component');

class CircuitList extends Component {
  constructor (settings = {}) {
    super(settings);

    this.settings = Object.assign({
      title: 'Circuits',
      handle: 'maki-circuit-list'
    }, settings);

    // README: probably handled upstream in Fabric state (or @fabric/http?)
    this.circuits = [];

    return this;
  }

  _getInnerHTML () {
    let html = `<div class="ui segment"><maki-circuit-builder></maki-circuit-builder></div><div class="ui segment">`;
    html += '<h3>Circuits</h3>';
    html += `<div class="ui cards">`;

    for (let i = 0; i < this.circuits.length; i++) {
      let chain = this.circuits[i];
      html += `<div class="ui card"><div class="content"><h3><a href="/circuits/${chain.symbol}">${chain.name}</a></h3><p>${chain.description || ''}</p></div></div>`;
    }

    html += `</div>`;
    html += '</div>';
    return html;
  }
}

module.exports = CircuitList;
