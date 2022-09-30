'use strict';

const Remote = require('./remote');

// dependencies
const scrape = require('metascraper');
const { URL } = require('url');

class HTTPClient {
  constructor (settings = {}) {
    this.config = Object.assign({
      host: 'localhost',
      secure: true,
      port: 9999
    }, settings);

    // TODO: remove import requirement, use local definition
    this.client = new Remote({
      host: this.config.host,
      secure: this.config.secure,
      port: this.config.port
    });
  }

  async get (path, params = {}) {
    return this._GET(path, params);
  }

  async put (path, data, params = {}) {
    return this._PUT(path, data params);
  }

  async _GET (path, params = {}) {
    return this.client._GET(path, params);
  }

  async _PUT (path, data) {
    return this.client._PUT(path, data);
  }

  async _POST (path, data) {
    return this.client._POST(path, data);
  }

  async _PATCH (path, data) {
    return this.client._PATCH(path, data);
  }

  async _DELETE (path) {
    return this.client._DELETE(path);
  }

  async _OPTIONS (path) {
    return this.client._OPTIONS(path);
  }

  async crawl (address) {
    let url = new URL(address);
    let remote = new Remote({
      host: url.hostname,
      port: url.port,
      secure: (url.protocol === 'https') ? true : false
    });

    let content = await remote._GET(url.pathname);
    let metadata = await scrape({
      url: address,
      html: content
    });

    return { metadata, content };
  }
}

module.exports = HTTPClient;
