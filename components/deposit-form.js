'use strict';

const Component = require('./component');

class DepositForm extends Component {
  constructor (settings = {}) {
    super(settings);

    this.settings = Object.assign({
      title: 'Deposit Form',
      handle: 'maki-deposit-form'
    });

    return this;
  }

  _increaseDeposit (event) {
    event.preventDefault();
    console.log('TODO: prepare data, submit');
  }

  _getInnerHTML () {
    return `<div class="ui form">
      <div class="ui label">
        <div class="ui two fields">
          <div class="ui field">
            <label>Source</label>
            <select name="source" class="ui search dropdown">
              <option selected value="wallet">@maki/wallet</option>
            </select>
          </div>
          <div class="ui field">
            <label>Current Balance</label>
            <maki-wallet-card data-value="0.00000000"><input type="number" value="0.00000000" disabled class="ui disabled input"/></maki-wallet-card>
          </div>
        </div>
        <div class="ui inline fields">
          <div class="ui field">
            <select name="symbol" class="ui search dropdown">
              <option selected value="BTC">BTC</option>
              <option value="INK">INK</option>
            </select>
          </div>
          <div class="ui field">
            <input type="number" name="amount" value="1.00" step="0.00000001" required />
          </div>
          <div class="ui field">
            <div class="ui fluid right labeled icon button" data-action="_increaseDeposit">Deposit <i class="loading icon"></i></div>
          </div>
        </div>
        <div class="ui field">
          <maki-wallet-deposit></maki-wallet-deposit>
        </div>
        <div class="ui message">
          <h3 class="ui header">Careful!</h3>
          <p>This amount will be locked for the duration of the contract.</p>
        </div>
      </div>
    </div>`;
  }
}

module.exports = DepositForm;
