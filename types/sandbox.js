'use strict';

const puppeteer = require('puppeteer');
const Service = require('@fabric/core/types/service');

class Sandbox extends Service {
  constructor (settings = {}) {
    super(settings);

    this.settings = Object.assign({
      browser: {
        headless: true,
        slowMo: 1000, // limit to 1 hz
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
    this.browser.on('console', (msg) => {
      this.emit('debug', `Sandbox console emitted: ${msg.text()}`)
    });

    await this.browser.setViewport(this.settings.browser.viewport);

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
    return this;
  }
}

module.exports = Sandbox;
