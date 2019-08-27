'use strict';

const Component = require('../types/component');

class Masthead extends Component {
  constructor (settings = {}) {
    super(settings);
    this.settings = Object.assign({
      handle: 'maki-masthead'
    }, settings);
    this.state = {};
    return this;
  }

  _getInnerHTML () {
    let html = ``;
    html += `<fabric-grid-row class="ui inverted vertical masthead segment">
      <div class="ui container">
        <h1 class="header">${this.title}</h1>
        <h2 class="subtitle">${this.subtitle}</h2>
        <a href="/worlds" class="ui right labeled primary icon button">Explore <i class="right chevron icon"></i></a>
      </div>
    </fabric-grid-row>`;
    return html;
  }
}

module.exports = Masthead;
