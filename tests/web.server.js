'use strict';

const assert = require('assert');
// const expect = require('chai').expect;

// Web
const HTTPServer = require('../types/server');
const HTTPClient = require('../types/client');

describe('@fabric/web', function () {
  describe('Server', function () {
    it('should expose a constructor', function () {
      assert.equal(typeof HTTPServer, 'function');
    });

    it('should start smoothly', async function () {
      let server = new HTTPServer({
        verbosity: 5
      });

      try {
        await server.start();
      } catch (E) {
        console.error('Could not start:', E);
      }

      try {
        await server.stop();
      } catch (E) {
        console.error('Could not stop:', E);
      }

      assert.ok(server);
      assert.equal(server.status, 'stopped');
    });

    xit('can serve a simple GET request', async function () {
      let client = new HTTPClient();
      let server = new HTTPServer();

      await server.start();

      let result = await client._GET('/');

      assert.ok(result);

      await server.stop();
    });
  });
});
