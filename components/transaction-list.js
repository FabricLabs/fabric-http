'use strict';

const Component = require('./component');

class TransactionList extends Component {
  constructor (settings = {}) {
    super(settings);

    this.settings = Object.assign({
      title: 'Transactions',
      handle: 'maki-transaction-list'
    }, settings);

    // README: probably handled upstream in Fabric state (or @fabric/http?)
    this.transactions = [];

    return this;
  }

  _getInnerHTML () {
    let html = `<div class="ui segment"><maki-transaction-builder></maki-transaction-builder></div><div class="ui segment">`;
    html += '<h3>Transactions</h3>';
    html += `<div class="ui cards">`;

    for (let i = 0; i < this.transactions.length; i++) {
      let chain = this.transactions[i];
      html += `<div class="ui card"><div class="content"><h3><a href="/transactions/${chain.symbol}">${chain.name}</a></h3><p>${chain.description || ''}</p></div></div>`;
    }

    html += `</div>`;
    html += '</div>';
    return html;
  }
}

module.exports = TransactionList;
