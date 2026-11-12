'use strict';

const assert = require('assert');
const http = require('http');
const net = require('net');
const os = require('os');
const path = require('path');
const WebSocket = require('ws');

const HTTPServer = require('../types/server');

function ephemeralPort () {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.listen(0, '127.0.0.1', () => {
      const addr = s.address();
      const port = typeof addr === 'object' && addr ? addr.port : null;
      s.close((err) => (err ? reject(err) : resolve(port)));
    });
    s.on('error', reject);
  });
}

/** Resolves 'open' or the HTTP status of a refused upgrade. */
function tryConnect (port, origin) {
  return new Promise((resolve) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/`, origin ? { origin } : {});
    ws.on('open', () => { ws.close(); resolve('open'); });
    ws.on('unexpected-response', (req, res) => resolve(res.statusCode));
    ws.on('error', () => resolve('error'));
  });
}

describe('@fabric/http websocket.verifyOrigin', function () {
  this.timeout(20000);

  it('accepts or refuses upgrades by the hook, and refuses when it throws', async function () {
    const port = await ephemeralPort();
    const seen = [];
    const server = new HTTPServer({
      port,
      host: '127.0.0.1',
      interface: '127.0.0.1',
      hostname: '127.0.0.1',
      listen: true,
      accessLog: path.join(os.tmpdir(), `fabric-http-ws-origin-${port}.log`),
      websocket: {
        verifyOrigin (req) {
          const origin = req.headers.origin || '';
          seen.push(origin);
          if (origin === 'https://throws.example') throw new Error('boom');
          return origin !== 'https://evil.example';
        }
      }
    });

    await server.start();
    try {
      assert.strictEqual(await tryConnect(port), 'open', 'no Origin');
      assert.strictEqual(await tryConnect(port, `http://127.0.0.1:${port}`), 'open', 'same origin');
      assert.strictEqual(await tryConnect(port, 'https://evil.example'), 401);
      assert.strictEqual(await tryConnect(port, 'https://throws.example'), 401);
      assert.ok(seen.includes('https://evil.example'));
    } finally {
      await server.stop();
    }
  });

  it('without a hook, accepts this host and pinned origins and refuses another site', async function () {
    const port = await ephemeralPort();
    const server = new HTTPServer({
      port,
      host: '127.0.0.1',
      interface: '127.0.0.1',
      hostname: '127.0.0.1',
      listen: true,
      accessLog: path.join(os.tmpdir(), `fabric-http-ws-default-origin-${port}.log`),
      passport: { pinnedOrigins: ['https://app.example'] }
    });

    await server.start();
    try {
      assert.strictEqual(await tryConnect(port), 'open', 'no Origin');
      assert.strictEqual(await tryConnect(port, `http://127.0.0.1:${port}`), 'open', 'this host');
      assert.strictEqual(await tryConnect(port, 'https://app.example'), 'open', 'pinned');
      assert.strictEqual(await tryConnect(port, 'https://evil.example'), 401);
    } finally {
      await server.stop();
    }
  });

  it('sends frame-ancestors on HTML and keeps a policy the page already set', async function () {
    const port = await ephemeralPort();
    const server = new HTTPServer({
      port,
      host: '127.0.0.1',
      interface: '127.0.0.1',
      hostname: '127.0.0.1',
      listen: true,
      accessLog: path.join(os.tmpdir(), `fabric-http-frame-${port}.log`),
      routes: [
        {
          method: 'GET',
          path: '/frame-default',
          handler (req, res) {
            res.status(200).set('Content-Type', 'text/html; charset=utf-8').send('<p>ok</p>');
          }
        },
        {
          method: 'GET',
          path: '/frame-own',
          handler (req, res) {
            res.status(200);
            res.set('Content-Security-Policy', "frame-ancestors 'none'");
            res.set('Content-Type', 'text/html; charset=utf-8');
            res.send('<p>own</p>');
          }
        }
      ]
    });

    function get (pathname) {
      return new Promise((resolve, reject) => {
        http.get({ hostname: '127.0.0.1', port, path: pathname }, (res) => {
          res.resume();
          res.on('end', () => resolve(res.headers));
        }).on('error', reject);
      });
    }

    await server.start();
    try {
      const plain = await get('/frame-default');
      assert.strictEqual(plain['content-security-policy'], "frame-ancestors 'self'");
      const own = await get('/frame-own');
      assert.strictEqual(own['content-security-policy'], "frame-ancestors 'none'");
    } finally {
      await server.stop();
    }
  });
});
