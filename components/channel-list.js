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
    element.settings.description = 'Provide an address to open a channel with and an <strong>amount</strong> to bond as deposit.  <strong>Fees will paid using this deposit.</strong>';
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
    html += `<table class="ui celled table">
  <thead>
    <tr>
      <th>#</th>
      <th>Hash</th>
      <th>Raw</th>
    </tr>
  </thead>
  <tbody>`;

    for (let i = 0; i < this.state.channels.length; i++) {
      let channel = this.state.channels[i];
      html += `<tr>
  <td>${channel.id}</td>
  <td>${channel.hash}</td>
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
