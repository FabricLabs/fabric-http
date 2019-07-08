'use strict';

const bcoin = require('bcoin/lib/bcoin-browser').set('testnet');

const Fabric = require('@fabric/core');
// const Component = require('./component');
const Wallet = require('../types/wallet');
const WalletCard = require('./wallet-card');

class MakiWallet extends Fabric.Service {
  constructor (settings = {}) {
    super(settings);

    this.settings = Object.assign({
      title: 'Wallet',
      handle: 'maki-wallet'
    }, settings);

    this.card = new WalletCard();
    this.wallet = new Wallet();

    this.state = {
      keys: [],
      assets: {
        btc: { balance: 0.0 },
        eth: { balance: 0.0 },
        bch: { balance: 0.0 }
      },
      addresses: {},
      transactions: []
    };

    this.watcher = setInterval(this._logWatchAddresses.bind(this), 1000);

    return this;
  }

  _logWatchAddresses () {
    console.log('[FABRIC:WALLET]', 'watching:', this.state.addresses);
  }

  _getDepositAddress () {
    return this.wallet._getDepositAddress();
  }

  _getFirstTenAddresses () {
    let depositAddressesToPrint = 10;
    for (var i = 0; i < depositAddressesToPrint; i++) {
      console.log(this.wallet.database.deriveReceive(i).getAddress('string'));
    }
  }

  _generateWalletKey () {
    // TODO: migrate this from scripts/rpg.js
  }

  disconnectedCallback () {
    super.disconnectedCallback();
    return this.stop();
  }

  _getInnerHTML () {
    let html = ``;

    html += `<div class="ui segment">
      <h4>Your Balances</h4>
      <fabric-grid-row data-bind="/assets">
        <table class="ui table">
          <tr>
            <td><strong>BTC</strong>:</td>
            <td><code>${this.state.assets.btc.balance}</code></td>
            <td><div class="ui mini button" data-action="_createDeposit" data-currency="BTC">Deposit</div></td>
          </tr>
          <tr>
            <td><strong>ETH</strong>:</td>
            <td><code>${this.state.assets.eth.balance}</code></td>
            <td><div class="ui mini button" data-action="_createDeposit" data-currency="ETH">Deposit</div></td>
          </tr>
          <tr>
            <td><strong>BCH</strong>:</td>
            <td><code>${this.state.assets.bch.balance}</code></td>
            <td><div class="ui mini button" data-action="_createDeposit" data-currency="BCH">Deposit</div></td>
          </tr>
        </table>
      </fabric-grid-row>`;

    html += `<div class="ui card">`;
    html += `<div class="content">`;
    html += '<h3 class="header">Wallet</h3>';
    html += '<h4 class="header">Deposit Address</h4>';
    html += `<div><center><code>${this.wallet.address}</code></center></div>`;
    html += '<button data-action="_generateWalletKey" class="ui button">Create New Address</button>';
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
    html += '</div>';

    return html;
  }

  async stop () {
    await super.stop();
    clearInterval(this.watcher);
    return this;
  }
}

module.exports = MakiWallet;
