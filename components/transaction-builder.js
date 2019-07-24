'use strict';

const Component = require('./component');

class TransactionList extends Component {
  constructor (settings = {}) {
    super(settings);

    this.settings = Object.assign({
      title: 'Transactions',
      handle: 'maki-transaction-builder'
    }, settings);

    // README: probably handled upstream in Fabric state (or @fabric/http?)
    this.transactions = [];

    return this;
  }

  _getInnerHTML () {
    let html = ``;

    html += `<form class="ui form">`;
    html += `<div class="ui fields">`;
    html += `</div>`;
    html += `</form>`;

    return html;
  }
}

module.exports = TransactionList;
