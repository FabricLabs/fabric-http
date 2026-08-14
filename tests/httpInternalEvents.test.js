'use strict';

const assert = require('assert');
const net = require('net');
const Server = require('../types/server');

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
    if (tx) {
      assert.ok(!tx['@data'] || tx['@data'].state === undefined);
    }
  });
});
