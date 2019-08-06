'use strict';

const Component = require('./component');

class TransactionBuilder extends Component {
  constructor (settings = {}) {
    super(settings);

    this.settings = Object.assign({
      title: 'Transaction Builder',
      handle: 'maki-transaction-builder'
    }, settings);

    // README: probably handled upstream in Fabric state (or @fabric/http?)
    this.transactions = [];

    return this;
  }

  attachedCallback () {
    super.attachedCallback();
    window.app.circuit._registerMethod('_confirmTransactionDetails', this._confirmTransactionDetails.bind(this));
  }

  _confirmTransactionDetails (event) {
    event.preventDefault();

    let modal = document.createElement('maki-modal');

    modal._openModal();
  }

  _getInnerHTML () {
    let html = ``;

    html += `<h3>${this.settings.title}</h3><form action="/transactions" method="POST" class="ui form">`;
    html += `<div class="ui fields">`;
    html += `<div class="ui field">
        <label for="address">Destination</label>
        <input type="text" name="address" required />
      </div>`;
    html += `<div class="ui field">
        <label for="address">Amount</label>
        <input type="number" name="amount" required />
      </div>`;
    html += `</div>`;
    html += `<button class="ui right labeled green icon button" data-action="_confirmTransactionDetails">Create Transaction <i class="money icon"></i></button>`;
    html += `</form>`;

    return html;
  }
}

module.exports = TransactionBuilder;
