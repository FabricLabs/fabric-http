'use strict';

// Configuration
const TEST_CONFIG = require('../settings/test');

// Test
const assert = require('assert');
const net = require('net');

// Dependencies
const WebSocket = require('ws');

function ephemeralPort () {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.listen(0, '127.0.0.1', () => {
      const addr = s.address();
      const p = typeof addr === 'object' && addr ? addr.port : null;
      s.close((err) => (err ? reject(err) : resolve(p)));
    });
    s.on('error', reject);
  });
}

// Types
const Client = require('../types/client');
const Server = require('../types/server');
const HTTPServer = require('../types/server');
const { httpRequest } = require('./helpers/httpRequest');

describe('@fabric/http/types/server', function () {
  describe('Server', function () {
    this.timeout(10000);

    it('should expose a constructor', function () {
      assert.equal(typeof Server, 'function');
    });

    it('should start (and stop) smoothly', async function () {
      const port = await ephemeralPort();
      const server = new Server(Object.assign({}, TEST_CONFIG, {
        port,
        host: '127.0.0.1',
        hostname: '127.0.0.1'
      }));

      try {
        await server.start();
      } catch (E) {
        console.error('Could not start:', E);
        throw E;
      }

      try {
        await server.stop();
      } catch (E) {
        console.error('Could not stop:', E);
        throw E;
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

describe('HTTP POST null body', function () {
  it('legacy POST without a body returns 400 instead of throwing', async function () {
    const server = Object.create(HTTPServer.prototype);
    server.settings = { verbosity: 0, debug: false, security: {} };
    server.routes = [];
    server.resources = { get () { return null; } };
    server._POST = async function () {
      throw new Error('should not POST');
    };
    const out = { statusCode: 0, body: null };
    const res = {
      status (code) { out.statusCode = code; return this; },
      json (body) { out.body = body; return this; },
      end () { return this; },
      redirect () { out.redirected = true; return this; }
    };
    await HTTPServer.prototype._handleRoutableRequest.call(server, {
      method: 'POST',
      path: '/collections/widgets',
      body: null,
      authenticated: false
    }, res, function next () { out.next = true; });
    assert.strictEqual(out.statusCode, 400);
    assert.strictEqual(out.body && out.body.message, 'JSON body required');
    assert.strictEqual(out.redirected, undefined);
  });
});

describe('JSON-RPC CORS preflight (browser → localhost Hub)', function () {
  this.timeout(60000);

  it('OPTIONS /services/rpc is 204 with CORS headers when cors is enabled', async function () {
    const port = await ephemeralPort();
    const server = new HTTPServer({
      port,
      host: '127.0.0.1',
      interface: '127.0.0.1',
      hostname: '127.0.0.1',
      listen: true,
      cors: true,
      jsonRpc: { enabled: true, paths: ['/services/rpc'] }
    });
    await server.start();
    try {
      const r = await httpRequest({
        port,
        method: 'OPTIONS',
        path: '/services/rpc',
        headers: {
          Origin: 'chrome-extension://test',
          'Access-Control-Request-Method': 'POST',
          'Access-Control-Request-Headers': 'content-type, authorization'
        }
      });
      assert.strictEqual(r.statusCode, 204, `body: ${r.body}`);
      const allow = (r.headers['access-control-allow-origin'] || r.headers['Access-Control-Allow-Origin']);
      assert.ok(allow, 'expected Access-Control-Allow-Origin');
    } finally {
      await server.stop();
    }
  });
});

describe('HTTPServer internal event logging', function () {
  this.timeout(15000);

  it('does not print full Internal message bodies at default verbosity', async function () {
    const port = await ephemeralPort();
    const server = new Server({
      listen: true,
      port,
      interface: '127.0.0.1',
      networking: false,
      verbosity: 2
    });
    const lines = [];
    const orig = console.log;
    console.log = function () {
      lines.push(Array.prototype.slice.call(arguments).join(' '));
    };
    try {
      await server.start();
      server.emit('message', {
        '@type': 'Transaction',
        security_advisory: {
          summary: 'Malicious code in @zalastax/nolb-foo (npm)'
        }
      });
      assert.ok(!lines.some((line) => String(line).includes('security_advisory')));
      assert.ok(!lines.some((line) => String(line).includes('zalastax')));
    } finally {
      console.log = orig;
      await server.stop();
    }
  });

  it('commit Transaction data omits full state', async function () {
    const server = new Server({ listen: false, networking: false, verbosity: 2 });
    server._state.content.documents = { pad: 'x'.repeat(1024) };
    server.observer = require('fast-json-patch').observe(server._state.content);
    server._state.content.probe = 1;
    const seen = [];
    server.on('message', (msg) => seen.push(msg));
    await server.commit();
    const tx = seen.find((m) => m && m['@type'] === 'Transaction');
    assert.ok(tx, 'commit() must emit a Transaction message');
    assert.ok(!tx['@data'] || tx['@data'].state === undefined);
  });
});
