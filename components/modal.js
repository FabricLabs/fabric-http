'use strict';

const Component = require('./component');

class Modal extends Component {
  constructor (settings = {}) {
    super(settings);

    this.settings = Object.assign({
      title: 'Modal',
      description: 'An empty modal.',
      actions: [
        {
          title: 'Cancel',
          action: '_closeModal'
        }
      ],
      handle: 'maki-modal'
    }, settings);

    this.state = {};

    return this;
  }

  _getInnerHTML () {
    let html = `<div class="content">`;
    html += `<div class="description">${this.settings.description}</div>`;
    html += `<div class="actions">`;
    for (let i = 0; i < this.settings.actions; i++) {
      let action = this.settings.actions[i];
      html += `<div class="ui button" data-action="${action.action}">${action.title}</div>`;
    }
    html += '</div>';
    html += '</div>';
    return html;
  }

  render () {
    return `<${this.settings.handle}${(this.settings.id) ? ' id="' + this.settings.id + '"' : ''} class="ui modal">${this._getInnerHTML()}</${this.settings.handle}>`;
  }
}

module.exports = Modal;
