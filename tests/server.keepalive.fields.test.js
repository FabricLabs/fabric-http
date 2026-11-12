'use strict';

const assert = require('assert');
const net = require('net');
const WebSocket = require('isomorphic-ws');

const Key = require('@fabric/core/types/key');
const Message = require('@fabric/core/types/message');
const HTTPServer = require('../types/server');

function getFreePort () {
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

/** Open a socket, send `frames` once open, resolve with the first P2P_PONG received. */
function firstPong (port, frames) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    const timer = setTimeout(() => { ws.close(); reject(new Error('no pong')); }, 15000);
    ws.onerror = (e) => { clearTimeout(timer); reject(e.error || new Error('WebSocket error')); };
    ws.onopen = () => { for (const f of frames) ws.send(f); };
    ws.onmessage = (event) => {
      const buf = Buffer.isBuffer(event.data) ? event.data : Buffer.from(event.data);
      let msg = null;
      try { msg = Message.fromBuffer(buf); } catch (_) { return; }
      if (msg.type !== 'P2P_PONG') return;
      clearTimeout(timer);
      ws.close();
      resolve(msg);
    };
  });
}

describe('HTTPServer keepalives are field frames', function () {
  this.timeout(60000);
  let server;
  let port;

  before(async function () {
    port = await getFreePort();
    server = new HTTPServer({ port, hostname: '127.0.0.1' });
    await server.start();
  });

  after(async function () {
    if (server) await server.stop();
  });

  it('answers a field P2P_PING with a field P2P_PONG', async function () {
    const ping = Message.fromLegacyBody('P2P_PING', { nonce: '42' }).signWithKey(new Key());
    const pong = await firstPong(port, [ping.toBuffer()]);
    const parsed = Message.tryParseLegacyBody(pong);
    assert.strictEqual(parsed.encoding, 'fields');
    assert.ok(Number(parsed.value.nonce) > 0);
  });

  it('a text HEARTBEAT keepalive is accepted and the socket keeps answering', async function () {
    // HEARTBEAT is one-way (no reply); it used to be rebuilt as a JSON frame.
    const ping = Message.fromLegacyBody('P2P_PING', { nonce: '7' }).signWithKey(new Key());
    const pong = await firstPong(port, [JSON.stringify({ type: 'HEARTBEAT', data: 'beat' }), ping.toBuffer()]);
    assert.strictEqual(Message.tryParseLegacyBody(pong).encoding, 'fields');
  });
});
