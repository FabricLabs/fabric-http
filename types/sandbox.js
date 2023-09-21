'use strict';

const merge = require('lodash.merge');
const puppeteer = require('puppeteer');
const Service = require('@fabric/core/types/service');

class Sandbox extends Service {
  constructor (settings = {}) {
    super(settings);

    this.settings = merge({
      browser: {
        headless: true,
        slowMo: 1, // limit to 0.001 hz
        viewport: {
          height: 480,
          width: 640
        }
      },
      state: {
        status: 'PAUSED'
      }
    }, settings);

    this.browser = null;
    this.chromium = null;
    this.requests = [];

    this._state = {
      content: this.settings.state
    };

    return this;
  }

  async start () {
    this._state.content.status = 'STARTING';

    // Create browser instance
    this.chromium = await puppeteer.launch(this.settings.browser);
    this.browser = await this.chromium.newPage();

    /*
    // Connect to Chrome DevTools
    const client = await this.browser.target().createCDPSession();

    // Set throttling property
    await client.send('Network.emulateNetworkConditions', {
      'offline': false,
      'downloadThroughput': 56 * 1024 / 8,
      'uploadThroughput': Math.floor(24.4 * 1024 / 8),
      'latency': 1000
    });
    */

    // Browser event handlers
    this.browser.on('console', (msg) => {
      this.emit('debug', `Sandbox console emitted: ${msg.text()}`)
    });

    this.browser.on('request', (request) => {
      this.requests.push(request);
      const headers = request.headers();
      headers['X-Fabric-Identity'] = '<not defined>';
      request.continue({
        headers
      });
    });

    // Browser onfiguration
    await this.browser.setRequestInterception(true);
    await this.browser.setExtraHTTPHeaders({
      'X-Fabric-Identity': '<not defined>'
    });

    // A E S T H E T I C S
    await this.browser.setViewport(this.settings.browser.viewport);

    // Commit
    this._state.content.status = 'STARTED';
    this.commit();

    return this;
  }

  async stop () {
    await this.browser.close();
    await this.chromium.close();
    return this;
  }

  async _navigateTo (url) {
    await this.browser.goto(url);
    await this.browser.waitForNavigation();
    return this;
  }

  async download (url) {
    const response = await this.browser.goto(url /*, { waitUntil: 'networkidle0' } */);
    const buffer = await response.buffer();
    return this;
  }

  async export () {
    return this.browser.evaluate(() => document.querySelector('*').outerHTML);
  }
}

module.exports = Sandbox;
