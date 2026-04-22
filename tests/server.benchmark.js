'use strict';

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

describe('HTTPServer', function () {
  describe('WebSockets', function () {
    // Peer bootstrap + 1000 signed Pongs can exceed 60s on slower hosts / CI.
    this.timeout(180000);

    it('should handle 1000 messages', async function () {
      const port = await getFreePort();
      const key = new Key();
      const server = new HTTPServer({ port, hostname: '127.0.0.1' });
      await server.start();

      await new Promise((resolve, reject) => {
        let messageCount = 0;
        const maxMessages = 1000;
        const startTime = Date.now();
        const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);

        const doneTimer = setTimeout(() => {
          reject(new Error('timeout waiting for 1000 Pong messages'));
        }, 150000);

        ws.onerror = (e) => {
          clearTimeout(doneTimer);
          reject(e.error || new Error('WebSocket error'));
        };

        ws.onmessage = (event) => {
          const raw = event.data;
          const buf = Buffer.isBuffer(raw) ? raw : Buffer.from(raw);
          const msg = Message.fromBuffer(buf);
          if (msg.friendlyType === 'Pong' || msg.type === 'P2P_PONG') {
            messageCount++;
            if (messageCount >= maxMessages) {
              clearTimeout(doneTimer);
              ws.close();
              server.stop().then(resolve).catch(reject);
            }
          }
        };

        ws.onopen = () => {
          for (let i = 0; i < maxMessages; i++) {
            const msg = Message.fromVector(['Ping', startTime]).signWithKey(key);
            ws.send(msg.toBuffer());
          }
        };
      });
    });
  });
});
