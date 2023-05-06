'use strict';

// Dependencies
const assert = require('assert');
const puppeteer = require('puppeteer');

const Server = require('../types/server');

describe('bundles/browser.js', function () {
  describe('browser', function () {
    this.timeout(60000);

    it('provides a global fabric', async function () {
      const server = new Server({ port: 8484 });
      await server.start();

      const browser = await puppeteer.launch();
      const page = await browser.newPage();

      await page.goto('http://localhost:8484');
      await page.waitForSelector('fabric-site');

      const result = await page.evaluate(() => {
        return {
          window: window,
          foo: 'bar'
        };
      });

      await browser.close();
      await server.stop();

      assert.ok(server);
    });
  });
});
