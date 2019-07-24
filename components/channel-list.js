'use strict';

const Component = require('./component');

// Components
const Prompt = require('./prompt');
const Modal = require('./modal');
const ChannelCreator = require('./channel-creator');

class ChannelList extends Component {
  constructor (settings = {}) {
    super(settings);

    this.settings = Object.assign({
      title: 'Channels',
      handle: 'fabric-channel-list'
    }, settings);

    this.channels = [];
    this.state = {
      channels: this.channels,
      methods: {}
    };

    this.controls = {
      creation: new Modal({
        id: 'channel-creation-modal',
        title: 'Creating a Channel',
        description: 'Please provide the following information to create a channel:',
        question: null,
        content: '<fabric-channel-creator></fabric-channel-creator>' // TODO: consider render pathway
      })
    };

    return this;
  }

  connectedCallback () {
    super.connectedCallback();
    console.log('[CHANNEL:LIST]', 'Connected!', this.state);
    window.app.circuit._registerMethod('_showChannelCreationPrompt', this._showChannelCreationPrompt.bind(this));
  }

  _showChannelCreationPrompt (event) {
    console.log('[CHANNEL:LIST]', 'MODAL PROMPT PROTOTYPE, EVENT:', event);

    let target = document.querySelector('#ephemeral-content');
    let element = document.createElement('maki-modal');
    let creator = document.createElement('fabric-channel-creator');

    let content = element.querySelector('*');

    console.log('content element:', element);
    console.log('content querySelector:', content);
    console.log('creator html:', creator.outerHTML);

    creator.setAttribute('id', `${this.controls.creation.settings.id}-creator`);
    element.setAttribute('id', `${this.controls.creation.settings.id}`);

    element._setContent(creator.outerHTML);
    element.settings.title = 'Create a Channel';
    element.settings.description = `<div class="ui messages"><div class="ui message">
      <h4 class="ui header">Getting Started</h4>
      <p class="description">Provide an address to open a channel with an <strong>amount</strong> to bond as deposit.  <strong>Fees will paid using this deposit.</strong></p>
    </div>
    <div class="ui message">
      <h5 class="ui header">What fees?</h5>
      <p>Actions in Fabric are bonded to <strong>deposits</strong>, which are lost when contracts are violated.  Only sign messages from counterparties you trust, and <strong>always remember to verify!</strong></p>
    </div></div>`;
    element.settings.actions[1] = {
      action: '_submitModalForm',
      title: 'Start Channel',
      type: 'primary',
      icon: 'right chevron'
    };

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
    html += '<div class="ui buttons"><div class="ui right labeled icon button" data-action="_showChannelCreationPrompt">open channel <i class="icon add"></i></div></div>';
    html += '<h3>Channels</h3>';
    html += `<table class="ui small celled sortable table">
  <thead>
    <tr>
      <th>Name</th>
      <th>Status</th>
      <th>Input (hash)</th>
      <th>Source</th>
      <th>Deposit Amount</th>
      <th>Limit</th>
      <th>Risk (max)</th>
      <th>Symbol</th>
      <th>Raw</th>
    </tr>
  </thead>
  <tbody>`;

    for (let i = 0; i < this.state.channels.length; i++) {
      let channel = this.state.channels[i];
      html += `<tr>
  <td><a href="/channels/${channel.address}"><small class="subtle">#</small>${channel.name}</a></td>
  <td><div class="ui label">${channel.status || ''}</div></td>
  <td><code>${channel.address}</code></td>
  <td>${channel.source}</td>
  <td>${channel.amount}</td>
  <td>${channel.limit}</td>
  <td>${(channel.limit / channel.amount) * 100}%</td>
  <td>${channel.symbol}</td>
  <td>${channel.raw}</td>
</tr>`;
    }

    html += `</tbody>
      </table>`;
    html += '</div>';
    return html;
  }
}

module.exports = ChannelList;
