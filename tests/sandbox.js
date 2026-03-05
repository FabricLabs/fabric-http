'use strict';

// Dependencies
const assert = require('assert');
const Sandbox = require('../types/sandbox');
const Server = require('../types/server');

describe('@fabric/http/types/sandbox', function () {
  let server;

  before(async function () {
    this.timeout(60000);
    server = new Server({ port: 8484 });
    await server.start();
  });

  after(async function () {
    if (server) await server.stop();
  });

  describe('Sandbox', function () {
    this.timeout(60000);

    it('should expose a constructor', function () {
      assert.equal(typeof Sandbox, 'function');
    });

    it('can instantiate', function () {
      const sandbox = new Sandbox();
      assert.ok(sandbox);
    });

    xit('can start and stop', async function () {
      const sandbox = new Sandbox();
      await sandbox.start();
      await sandbox.stop();
      assert.ok(sandbox);
    });

    xit('can navigate to a well-established network resource', async function () {
      const sandbox = new Sandbox();
      await sandbox.start();
      await sandbox._navigateTo('https://google.com/');
      await sandbox.stop();
      assert.ok(sandbox);
    });

    xit('can navigate to a network resource', async function () {
      const sandbox = new Sandbox();
      await sandbox.start();
      await sandbox._navigateTo('http://localhost:8484/');
      await sandbox.stop();
      assert.ok(sandbox);
    });
  });
});
