'use strict';

const Component = require('./component');

class Prompt extends Component {
  constructor (settings = {}) {
    super(settings);
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

  _submitPrompt (event) {
    event.preventDefault();

    console.log('[MAKI:PROMPT]', 'Submitting prompt with event:', event);

    return this;
  }

  _getInnerHTML () {
    let html = `<form class="ui form" method="POST" data-action="_submitPrompt">
      <div class="field">
        <p>${this.settings.question}</p>
      </div>`;

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
