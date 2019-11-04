'use strict';

const Component = require('./component');

/**
 * Manage a table of columnar data.
 * @extends {Component}
 */
class Table extends Component {
  constructor (settings = {}) {
    super(settings);

    this.settings = Object.assign({
      title: 'Table',
      description: 'An empty table.',
      rows: [],
      methods: {},
      handle: 'maki-table'
    }, settings);

    this._state = {
      rows: this.settings.rows
    };

    return this;
  }

  connectedCallback () {
    super.connectedCallback();
    console.log('[MAKI:TABLE]', 'connected!');
    window.app.circuit._registerMethod('_resortRows', this._resortRows.bind(this));
  }

  _resortRows (event) {
    this.status = 'resorting';
    // TODO: implement
    // this.emit('resort');
    this.status = 'resorted';
    return this;
  }

  /**
   * Sets the content of the modal.
   * @param {Table} content String of HTML to add as content.
   */
  _setContent (content) {
    this.settings.content = content;
    this.innerHTML = this._getInnerHTML();
    return this;
  }

  _getInnerHTML () {
    let html = `<div class="header">${this.settings.title}</div>`;
    html += `<div class="content">`;
    html += `<div class="description">${this.settings.description}</div>`;

    if (this.settings.content) {
      html += `<div class="content ui segment">${this.settings.content}</div>`;
    }

    html += '</div>';
    html += `<table class="ui table">`;
    html += `<tbody>`;

    for (let i = 0; i < this._state.rows.length; i++) {
      let row = this._state.rows[i];
      let fields = Object.keys(row);

      html += `<tr>`;

      for (let j = 0; j < fields.length; j++) {
        html += `<td>`;
        html += `<code>${row}</code>`;
        html += `</td>`;
      }

      html += `</tr>`;
    }

    html += '</tbody>';
    html += '</table>';
    html += '</div>';

    return html;
  }
}

module.exports = Table;
