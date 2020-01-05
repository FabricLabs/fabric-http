'use strict';

const Component = require('../types/component');

class Document extends Component {
  constructor (settings = {}) {
    super(settings);
    this.settings = Object.assign({
      href: '/',
      handle: 'fabric-document'
    }, settings);
    return this;
  }

  async _loadDocument () {
    let link = this.settings.href;
    let doc = await fetch(link);
    console.log('doc:', doc);
    return doc;
  }

  _getInnerHTML () {
    return `<div class="ui segment">
      <div class="content"><code>${this.settings.href}</code><button class="ui button" data-action="_loadDocument">load</button></div>
      <div class="content"></div>
      <div class="bottom attached content">
        <div class="ui action buttons">
          <a class="button" href="#"><i class="linkify icon"></i></a>
        </a>
      </div>
    </div>`;
  }
}
