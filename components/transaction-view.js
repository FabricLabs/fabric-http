'use strict';

const Component = require('./component');

class TransactionView extends Component {
  constructor (settings = {}) {
    super(settings);

    this.settings = Object.assign({
      name: 'TransactionView',
      description: 'The default chain for a TransactionView.'
    }, settings);

    return this;
  }

  _getInnerHTML () {
    let html = `<portal-transaction-view>`;
    html += `<fabric-grid-row class="ui segment">
      <h3>Transaction #${this.id}<h3>
      <h4>Raw Data</h4>
      <p><code>${this.raw}</code></p>
      <fabric-grid-row>
        <fabric-grid-column>
          <h4>Inputs</h4>
          <table class="ui table">
          </table>
        </fabric-grid-column>
        <fabric-grid-column>
          <h4>Outputs</h4>
          <table class="ui table">
          </table>
        </fabric-grid-column>
      </fabric-grid-row>
    </fabric-grid-row>`;
    html += '</portal-transaction-view>';
    return html;
  }
}

module.exports = TransactionView;
