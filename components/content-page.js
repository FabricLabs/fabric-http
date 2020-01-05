'use strict';

const Component = require('../types/component');

// TODO: rename file to page.js?
// looks better when importing.
class ContentPage extends Component {
  constructor (settings = {}) {
    super(settings);

    this.settings = Object.assign({
      handle: 'fabric-content-page'
    });

    this.title = 'Example Content Page';
    this.content = '<p>Sample Content</p>';

    return this;
  }

  render () {
    return `<fabric-grid-row>
      <fabric-grid-row class="ui segment">
        <h1 class="ui header">${this.title}</h1>
        <fabric-grid-row>${this.content}</fabric-grid-row>
      </fabric-grid-row>
    <fabric-grid-row>`;
  }
}

module.exports = ContentPage;
