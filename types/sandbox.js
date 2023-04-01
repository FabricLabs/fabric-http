'use strict';

const puppeteer = require('puppeteer');
const Service = require('@fabric/core/types/service');

class Sandbox extends Service {
  constructor (settings = {}) {
    super(settings);

    this.settings = Object.assign({
      browser: {
        headless: true,
        slowMo: 1000 // limit to 1 hz
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
    this.chromium = await puppeteer.launch(this.settings.browser);
    this.browser = await this.chromium.newPage();
    this.commit();
    return this;
  }

  async _navigateTo (url) {
    await this.browser.goto(url);
  }
}

module.export = Sandbox;
