'use strict';

const Component = require('./component');

class ChannelCreator extends Component {
  constructor (settings = {}) {
    super(settings);

    this.settings = Object.assign({
      input: null,
      handle: 'fabric-channel-creator'
    }, settings);

    this.state = {};

    return this;
  }

  _submitFormWithData (event) {
    event.preventDefault();
    console.log('WHOA EVENT:', event);
  }

  attachedCallback () {
    super.attachedCallback();
    console.log('channel creator attached!');
    window.app.circuit._registerHandler('submit', this._submitFormWithData.bind(this));
    window.app.circuit._registerMethod('_submitFormWithData', this._submitFormWithData.bind(this));
  }

  _getInnerHTML () {
    return `<form class="ui fluid form" action="/channels" method="POST" data-action="_submitFormWithData">
      <div class="ui field">
        <label for="address">Address</label>
        <input type="text" name="address" placeholder="Address to connect to (generally a sha256 hash)" class="required fluid input" />
      </div>
      <div class="ui fluid fields">
        <div class="ui field">
          <label for="name">Name</label>
          <input type="text" name="name" placeholder="Label for this channel (local only)" class="required input" />
        </div>
        <div class="ui field">
          <label for="limit">Limit</label>
          <input type="number" name="limit" value="0.0001" step="0.00000001" data-currency="BTC" class="required input" />
        </div>
        <div class="ui field">
          <label for="deposit">Deposit</label>
          <input type="hidden" name="deposit" value="${this.settings.input || ''}" />
          <maki-deposit-form></maki-deposit-form>
        </div>
      </div>
    </form>`;
  }
}

module.exports = ChannelCreator;
