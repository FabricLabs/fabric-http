'use strict';

// const Component = require('./component');

class BrowserContent {
  constructor (settings = {}) {
    // super(settings);

    this.settings = Object.assign({
      name: 'UnsafeBrowserContent',
      title: 'UnsafeBrowserContent',
      handle: 'fabric-browser-content'
    }, settings);

    return this;
  }

  _getInnerHTML () {
    let html = ``;
    html += `<div class="ui segment loading">`;
    html += `<h1 class="header">Preparing content...</h1>`;
    html += `<p>The application is compiling your document.  Unless you've enabled JavaScript or are using the Fabric Browser, this message should not remain visible for long.</p>`;
    html += `</div>`;
    return html;
  }

  render () {
    return `<fabric-browser-content id="browser-content" class="ui container">${this._getInnerHTML()}</fabric-browser-content>`;
  }
}

module.exports = BrowserContent;
