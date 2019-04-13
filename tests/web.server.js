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
      let server = new HTTPServer();
      await server.start();
      assert.ok(server);
      await server.stop();
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
