'use strict';

// Configuration
const TEST_CONFIG = require('../settings/test');

// Test
const assert = require('assert');

// Dependencies
const WebSocket = require('ws');

// Types
const Client = require('../types/client');
const Server = require('../types/server');

describe('@fabric/http/types/server', function () {
  describe('Server', function () {
    this.timeout(10000);

    it('should expose a constructor', function () {
      assert.equal(typeof Server, 'function');
    });

    it('should start (and stop) smoothly', async function () {
      const server = new Server(TEST_CONFIG);

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
      assert.equal(server.status, 'STOPPED');
    });

    xit('can serve a simple GET request', async function () {
      const client = new Client(TEST_CONFIG);
      const server = new Server(TEST_CONFIG);

      let result = null;

      try {
        await server.start();
      } catch (exception) {
        assert.fail(exception);
      }

      try {
        result = await client._GET('/');
      } catch (exception) {
        assert.fail(exception);
      }

      try {
        await server.flush();
      } catch (exception) {
        assert.fail(exception);
      }

      try {
        await server.stop();
      } catch (exception) {
        assert.fail(exception);
      }

      assert.ok(result);
    });

    xit('can serve a custom route', async function () {
      const client = new Client({ port: 8484, host: 'localhost', secure: false });
      const server = new Server({ port: 8484 });

      server._addRoute('GET', '/examples/restricted', (req, res, next) => {
        return res.send({ type: 'SecretDocument' })
      });

      let result = null;

      try {
        await server.start();
      } catch (exception) {
        assert.fail(exception);
      }

      try {
        result = await client._GET('/examples/restricted');
      } catch (exception) {
        assert.fail(exception);
      }

      try {
        await server.flush();
      } catch (exception) {
        assert.fail(exception);
      }

      try {
        await server.stop();
      } catch (exception) {
        assert.fail(exception);
      }

      assert.ok(result);
    });

    xit('can store an object in a collection', async function () {
      const client = new Client(TEST_CONFIG);
      const server = new Server(TEST_CONFIG);
      let result = null;
      let posted = null;

      let object = {
        name: 'Sample'
      };

      try {
        await server.start();
      } catch (exception) {
        assert.fail(exception);
      }

      try {
        posted = await client._POST('/examples', object);
      } catch (exception) {
        assert.fail(exception);
      }

      try {
        result = await client._GET('/examples');
      } catch (exception) {
        assert.fail(exception);
      }

      try {
        await server.flush();
      } catch (exception) {
        assert.fail(exception);
      }

      try {
        await server.stop();
      } catch (exception) {
        assert.fail(exception);
      }

      assert.ok(result);
      assert.equal(result.length, 1);
    });

    xit('can restore collections after a restart', async function () {
      const client = new Client(TEST_CONFIG);
      const server = new Server(TEST_CONFIG);
      let result = null;
      let posted = null;
      let prior = null;

      let object = {
        name: 'Sample'
      };

      try {
        await server.start();
      } catch (exception) {
        assert.fail(exception);
      }

      try {
        prior = await client._GET('/examples');
      } catch (exception) {
        assert.fail(exception);
      }

      try {
        posted = await client._POST('/examples', object);
      } catch (exception) {
        assert.fail(exception);
      }

      try {
        await server.stop();
      } catch (exception) {
        assert.fail(exception);
      }

      try {
        await server.start();
      } catch (exception) {
        assert.fail(exception);
      }

      try {
        result = await client._GET('/examples');
      } catch (exception) {
        assert.fail(exception);
      }

      try {
        await server.flush();
      } catch (exception) {
        assert.fail(exception);
      }

      try {
        await server.stop();
      } catch (exception) {
        assert.fail(exception);
      }

      assert.ok(result);
      assert.equal(prior.length, 0);
      assert.equal(result.length, 1);
    });

    xit('can handle a websocket connection', function (done) {
      async function test () {
        const client = new Client(TEST_CONFIG);
        const server = new Server(TEST_CONFIG);
        let result = null;
        let posted = null;
        let prior = null;

        let object = {
          name: 'Sample'
        };

        try {
          await server.start();
        } catch (exception) {
          assert.fail(exception);
        }

        let socket = new WebSocket(`ws://${TEST_CONFIG.authority}:${TEST_CONFIG.port}/`);

        socket.on('open', function onOpen () {
          console.log('socket open!');
        });

        socket.on('close', async function onClose () {
          console.log('socket closed!');
        });

        socket.on('message', async function onMessage (msg) {
          let message = null;

          try {
            message = JSON.parse(msg);
          } catch (exception) {
            assert.fail(`Exception: ${exception}`);
          }

          switch (message['@type']) {
            default:
              console.warn('Unhandled message type from WebSocket:', message['@type']);
              break;
            case 'StateUpdate':
              // console.log('got StateUpdate message:', message);
              break;
          }
        });

        try {
          prior = await client._GET('/examples');
        } catch (exception) {
          assert.fail(exception);
        }

        try {
          posted = await client._POST('/examples', object);
        } catch (exception) {
          assert.fail(exception);
        }

        try {
          result = await client._GET('/examples');
        } catch (exception) {
          assert.fail(exception);
        }

        assert.ok(result);
        assert.equal(prior.length, 0);
        assert.equal(result.length, 1);

        setTimeout(async function () {
          await socket.close();
          await server.flush();
          await server.stop();
          done();
        }, 1000);
      }

      test();
    });
  });
});
