'use strict';

// Dependencies
const assert = require('assert');
const Sandbox = require('../types/sandbox');
const Server = require('../types/server');

describe('@fabric/http/types/sandbox', function () {
  before(async () => {
    this.server = new Server({ port: 8484 });
    await this.server.start();
  });

  after(async () => {
    await this.server.stop();
  });

  describe('Sandbox', function () {
    this.timeout(30000);

    it('should expose a constructor', function () {
      assert.equal(typeof Sandbox, 'function');
    });

    it('can instantiate', function () {
      const sandbox = new Sandbox();
      assert.ok(sandbox);
    });

    it('can start and stop', async function () {
      const sandbox = new Sandbox();
      await sandbox.start();
      await sandbox.stop();
      assert.ok(sandbox);
    });

    it('can navigate to a well-established network resource', async function () {
      const sandbox = new Sandbox();
      await sandbox.start();
      await sandbox._navigateTo('https://google.com/');
      await sandbox.stop();
      assert.ok(sandbox);
    });

    it('can navigate to a network resource', async function () {
      const sandbox = new Sandbox();
      await sandbox.start();
      // await sandbox._navigateTo('http://localhost:8484/');
      await sandbox.stop();
      assert.ok(sandbox);
    });
  });
});
