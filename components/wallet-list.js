'use strict';

const Component = require('./component');

// Components
const Prompt = require('./prompt');
const Modal = require('./modal');
const WalletCreator = require('./wallet-creator');

class WalletList extends Component {
  constructor (settings = {}) {
    super(settings);

    this.settings = Object.assign({
      title: 'Wallets',
      handle: 'maki-wallet-list'
    }, settings);

    this.wallets = [];
    this.state = {
      wallets: this.wallets,
      methods: {}
    };

    this.controls = {
      creation: new Modal({
        id: 'wallet-creation-modal',
        title: 'Creating a Wallet',
        description: 'Please provide the following information to create a wallet:',
        question: null,
        content: '<fabric-wallet-creator></fabric-wallet-creator>' // TODO: consider render pathway
      })
    };

    return this;
  }

  connectedCallback () {
    super.connectedCallback();
    console.log('[WALLET:LIST]', 'Connected!', this.state);
    window.app.circuit._registerMethod('_showWalletCreationPrompt', this._showWalletCreationPrompt.bind(this));
  }

  _showWalletCreationPrompt (event) {
    console.log('[WALLET:LIST]', 'MODAL PROMPT PROTOTYPE, EVENT:', event);

    let target = document.querySelector('#ephemeral-content');
    let element = document.createElement('maki-modal');
    let creator = document.createElement('maki-wallet-creator');

    while (target.firstChild) {
      target.removeChild(target.firstChild);
    }

    let content = element.querySelector('*');

    console.log('content element:', element);
    console.log('content querySelector:', content);
    console.log('creator html:', creator.outerHTML);

    creator.setAttribute('id', `${this.controls.creation.settings.id}-creator`);
    element.setAttribute('id', `${this.controls.creation.settings.id}`);

    element._setContent(creator.outerHTML);
    element.settings.title = 'Welcome to your Wallet!';
    element.settings.description = 'To get started, create a new key or import one from memory.';
    /* element.settings.actions[1] = {
      action: '_submitModalForm',
      title: 'Generate Keys',
      type: 'primary',
      icon: 'right chevron'
    }; */

    element.className += 'ui modal';
    element.innerHTML = element._getInnerHTML();
    // creator.innerHTML = creator._getInnerHTML();

    window.app.modal = element;
    target.appendChild(element);

    console.log('the element:', element);
    console.log('the creator:', creator);

    // TODO: remove this monstrosity
    $(element).modal('setting', 'closable', false).modal('show');
    // $(element).modal('show');
  }

  _getInnerHTML () {
    let html = `<div class="ui segment">`;
    html += `<h3 class="ui header">Local Wallet</h3>`;
    html += `<maki-wallet></maki-wallet>`;
    html += `</div>`;
    html += `<div class="ui segment">`;
    html += '<div class="ui buttons"><div class="ui right labeled icon button" data-action="_showWalletCreationPrompt">open wallet <i class="icon add"></i></div></div>';
    html += '<h3>Wallets</h3>';
    html += `<table class="ui small celled sortable table">
  <thead>
    <tr>
      <th>Name</th>
      <th>Status</th>
      <th>Currency</th>
      <th>Balance</th>
      <th></th>
    </tr>
  </thead>
  <tbody>`;

    for (let i = 0; i < this.state.wallets.length; i++) {
      let wallet = this.state.wallets[i];
      html += `<tr>
  <td><a href="/wallets/${wallet.id}"><small class="subtle">#</small>${wallet.name}</a></td>
  <td><div class="ui label">${wallet.status || ''}</div></td>
  <td><code>${wallet.symbol}</code></td>
  <td><code>${wallet.balance}</code></td>
  <td><a href="/wallets/${wallet.id}" class="ui mini button">view</a></td>
</tr>`;
    }

    html += `</tbody>
      </table>`;
    html += '</div>';
    return html;
  }
}

module.exports = WalletList;
