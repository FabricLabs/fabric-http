'use strict';

const Component = require('./component');

/**
 * Prompt the user for some input with a {@link Modal}.
 * @extends {Component}
 */
class Modal extends Component {
  /**
   * The {@link Modal} {@link Component} provides an interrupting prompt for the
   * user to answer.  Progress is blocked until the prompt is complete, and no
   * computations will take place until user input is provided.
   * @param  {Object} [settings={}] Settings for the {@link Modal}.
   * @return {Component}            Instance of the the {@link Component}.
   */
  constructor (settings = {}) {
    super(settings);

    this.settings = Object.assign({
      title: 'Modal',
      description: 'An empty modal.',
      content: 'Nothing to see here.  Move along, adventurer.',
      actions: [
        {
          title: 'Cancel',
          action: '_closeModal'
        }
      ],
      methods: {},
      handle: 'maki-modal'
    }, settings);

    this.state = {
      actions: this.settings.actions,
      content: this.settings.content,
      methods: this.settings.methods
    };

    return this;
  }

  connectedCallback () {
    super.connectedCallback();
    console.log('[MAKI:MODAL]', 'connected!');

    window.app.circuit._registerMethod('_closeModal', this._closeModal.bind(this));
    window.app.circuit._registerMethod('_submitModalForm', this._submitModalForm.bind(this));
  }

  submit (event) {
    console.log('SUBMIT!', event, this);
    let form = this.querySelector('.content .content form');
    let data = $(form).serialize();
    console.log('got data:', data);

    let action = form.getAttribute('data-action');
    let target = form.getAttribute('action');

    console.log('action:', action);
    console.log('target:', target);
  }

  _closeModal (event) {
    return $('.ui.modal').modal('hide');
  }

  _submitModalForm (event) {
    event.preventDefault();
    console.log('TODO: submit modal form here', event, event.target, this);
    // if (window.app.modal) window.app.modal.submit();
    window.app.modal.submit();
  }

  _setContent (content) {
    this.settings.content = content;
    this.innerHTML = this._getInnerHTML();
    return this;
  }

  _getInnerHTML () {
    let html = `<div class="header">${this.settings.title}</div><div class="content">`;
    html += `<div class="description">${this.settings.description}</div>`;

    if (this.settings.content) {
      html += `<div class="content ui segment">${this.settings.content}</div>`;
    }

    html += '</div>';
    html += `<div class="actions">`;

    for (let i = 0; i < this.settings.actions.length; i++) {
      let action = this.settings.actions[i];
      html += `<div class="ui button${(action.type === 'primary') ? ' primary' : ''}${(action.icon) ? ' right labeled icon ' + action.icon : ''}" data-action="${action.action}">${action.title}${(action.icon) ? '<i class="' + action.icon + ' icon"></i>' : ''}</div>`;
    }

    html += '</div>';

    return html;
  }

  render () {
    return `<${this.settings.handle}${(this.settings.id) ? ' id="' + this.settings.id + '"' : ''} class="ui modal">${this._getInnerHTML()}</${this.settings.handle}>`;
  }
}

module.exports = Modal;
