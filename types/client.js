'use strict';

const Actor = require('@fabric/core/types/actor');
const Remote = require('./remote');

// dependencies
// const scrape = require('metascraper');
const { URL } = require('url');

/**
 * Generic HTTP Client.
 */
class HTTPClient extends Actor {
  /**
   * Create an instance of an HTTP client.
   * @param {Object} [settings] Configuration for the client.
   */
  constructor (settings = {}) {
    super(settings);

    this.settings = Object.assign({}, this.settings, settings);

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

    return this;
  }

  async DELETE (path, params = {}) {
    return this._DELETE(path, params);
  }

  async GET (path, params = {}) {
    return this._GET(path, params);
  }

  async PATCH (path, data, params = {}) {
    return this._PATCH(path, data, params);
  }

  async PUT (path, data, params = {}) {
    return this._PUT(path, data, params);
  }

  async POST (path, data, params = {}) {
    return this._POST(path, data, params);
  }

  async QUERY (path, params = {}) {
    return Object.assign({}, {
      path: path,
      query: params,
      results: this.get(path)
    });
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
    const url = new URL(address);
    const remote = new Remote({
      host: url.hostname,
      port: url.port,
      secure: (url.protocol === 'https') ? true : false
    });

    const content = await remote._GET(url.pathname);
    const metadata = await scrape({
      url: address,
      html: content
    });

    return { metadata, content };
  }

  async start () {
    const options = await this._OPTIONS('/');
    console.log('OPTIONS:', options);
    this._state.content.status = 'STARTED';
    return this;
  }
}

module.exports = HTTPClient;
