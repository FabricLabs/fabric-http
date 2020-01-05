'use strict';

// const Component = require('./component');

class Prompt {
  constructor (settings = {}) {
    // super(settings);

    this.settings = Object.assign({
      question: 'How can we help?',
      field: 'query',
      handle: 'maki-prompt',
      label: 'Your question',
      placeholder: 'Search documents, users, or ideas',
      content: null
    }, settings);

    return this;
  }

  attachedCallback () {
    console.log('[MAKI:PROMPT]', 'attached to document!');
    window.app._registerMethod('_submitPrompt', this._submitPrompt.bind(this));
  }

  async _submitPrompt (event) {
    event.preventDefault();

    console.log('[MAKI:PROMPT]', 'Submit event:', event);
    console.log('[MAKI:PROMPT]', 'Submit prompt:', prompt);

    let core = $(prompt);
    let form = $(core.children()[0]);
    let parts = qs.parse(form.serialize());

    console.log('[MAKI:PROMPT]', 'Submit core parts:', parts);

    let depositor = Object.assign({}, parts);
    let posted = await window.app.exchange._POST('/depositors', depositor);

    console.log('depositor:', depositor);
    console.log('posted:', posted);

    // console.log('[EXCHANGE:PROMPT]', 'Submit serialized:', core.children()[0].serialize());
  }

  _getInnerHTML () {
    let html = `<form class="ui form" method="POST" data-action="_submitPrompt">`;

    if (this.settings.question) {
      html += `
        <div class="field">
          <p>${this.settings.question}</p>
        </div>`;
    }

    if (this.settings.content) {
      html += this.settings.content;
    } else {
      html += `<div class="field">
          <label for="${this.settings.field}"><h3>${this.settings.label}</h3></label>
          <input type="text" name="${this.settings.field}" placeholder="${this.settings.placeholder}" />
        </div>
        <div class="right floated field">
          <button type="submit" class="ui submit button" data-action="_submitPrompt">Create</button>
        </div>
      </form>`;
    }

    return html;
  }
}

module.exports = Prompt;
