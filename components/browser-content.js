'use strict';

// const Component = require('./component');

class BrowserContent {
  constructor (settings = {}) {
    // super(settings);
    this.settings = Object.assign({
      name: 'UnsafeBrowserContent',
      handle: 'fabric-browser-content'
    }, settings);
    return this;
  }

  _getInnerHTML () {
    return `<fabric-sample class="ui segment loading"><h1>Waiting for data...</h1><p>The application is loading.  Unless you've enabled JavaScript or are using the Fabric Browser, this message should not remain visible for long.</p></fabric-sample>`;
  }

  render () {
    return `<fabric-browser-content id="browser-content">${this._getInnerHTML()}</fabric-browser-content>`;
  }
}

module.exports = BrowserContent;
