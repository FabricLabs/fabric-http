'use strict';

const Component = require('./component');

class WalletView extends Component {
  constructor (settings = {}) {
    super(settings);

    this.settings = Object.assign({
      title: 'Wallet View',
      handle: 'fabric-wallet-view'
    }, settings);

    this.state = {
      keys: [],
      transactions: []
    };

    return this;
  }

  _getInnerHTML () {
    let html = `<div class="ui card">`;
    html += '<h3>Wallet View<h3>';
    html += '<button data-action="_generateWallet ViewKey">Create New Key<button>';
    html += '<h4>Keys</h4>';
    for (let i = 0; i < this.state.keys.length; i++) {
      html += `<div>${JSON.stringify(this.state.keys.length)}</div>`;
    }
    html += '<h4>Transactions</h4>';
    html += '<div>';
    for (let i = 0; i < this.state.transactions.length; i++) {
      html += `<div>${JSON.stringify(this.state.transactions.length)}</div>`;
    }
    html += '</div>';
    html += '</div>';
    return html;
  }
}

module.exports = WalletView;
