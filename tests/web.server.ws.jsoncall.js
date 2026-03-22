'use strict';

const assert = require('assert');
const net = require('net');
const os = require('os');
const path = require('path');
const WebSocket = require('ws');

const Key = require('@fabric/core/types/key');
const Message = require('@fabric/core/types/message');
const HTTPServer = require('../types/server');

/** True when installed @fabric/core maps P2P_MESSAGE_RECEIPT to its own opcode (not GenericMessage). */
function coreSupportsP2PMessageReceipt () {
  try {
    const probe = Message.fromVector([
      'P2P_MESSAGE_RECEIPT',
      { '@type': 'Receipt', '@actor': 'probe', '@data': {}, '@version': 1 }
    ]);
    return probe.type === 'P2P_MESSAGE_RECEIPT';
  } catch (e) {
    return false;
  }
}

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

describe('@fabric/http/types/server', function () {
  describe('WebSocket JSONCall', function () {
    this.timeout(15000);

    it('replies with JSONCallResult then P2P_MESSAGE_RECEIPT', async function () {
      const port = await ephemeralPort();
      const accessLog = path.join(os.tmpdir(), `fabric-http-ws-jsoncall-${port}.log`);

      const server = new HTTPServer({
        port,
        host: '127.0.0.1',
        interface: '127.0.0.1',
        hostname: '127.0.0.1',
        listen: true,
        accessLog
      });

      server._registerMethod('FabricTestEcho', function (payload) {
        return Promise.resolve({ ok: true, payload });
      });

      await server.start();

      const clientKey = new Key();
      const callBody = JSON.stringify({
        method: 'FabricTestEcho',
        params: [{ hello: 'world' }]
      });
      const callMessage = Message.fromVector(['JSONCall', callBody]).signWithKey(clientKey);

      function isJSONCallResultFrame (msg) {
        if (!msg || msg.type !== 'JSONCall') return false;
        try {
          const inner = JSON.parse(msg.body);
          return inner && inner.method === 'JSONCallResult';
        } catch (e) {
          return false;
        }
      }

      function isReceiptFrame (msg) {
        if (!msg) return false;
        if (msg.type === 'P2P_MESSAGE_RECEIPT') return true;
        // Older buffers (before P2P_MESSAGE_RECEIPT opcode) decoded as GenericMessage + Receipt body
        if (msg.type !== 'GenericMessage') return false;
        try {
          const inner = JSON.parse(msg.body);
          return inner && inner['@type'] === 'Receipt' && inner['@version'] === 1;
        } catch (e) {
          return false;
        }
      }

      const inbound = await new Promise((resolve, reject) => {
        const frames = [];
        const ws = new WebSocket(`ws://127.0.0.1:${port}/`);
        const maxFrames = 32;
        const timer = setTimeout(() => {
          ws.close();
          reject(new Error('timeout waiting for JSONCallResult and P2P_MESSAGE_RECEIPT'));
        }, 10000);

        ws.on('open', () => {
          ws.send(callMessage.toBuffer());
        });

        ws.on('message', (data) => {
          try {
            const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
            frames.push(Message.fromBuffer(buf));

            const resultIdx = frames.findIndex(isJSONCallResultFrame);
            const receiptIdx = frames.findIndex(isReceiptFrame);

            if (resultIdx >= 0 && receiptIdx >= 0) {
              assert.ok(resultIdx < receiptIdx, 'JSONCallResult must be sent before P2P_MESSAGE_RECEIPT');
              clearTimeout(timer);
              ws.close();
              resolve({ frames, resultIdx, receiptIdx });
            } else if (frames.length > maxFrames) {
              clearTimeout(timer);
              reject(new Error(`too many frames (${frames.length}); types: ${frames.map((f) => f.type).join(', ')}`));
            }
          } catch (e) {
            clearTimeout(timer);
            reject(e);
          }
        });

        ws.on('error', (e) => {
          clearTimeout(timer);
          reject(e);
        });
      });

      try {
        await server.stop();
      } catch (e) {
        /* ignore */
      }

      const resultMsg = inbound.frames[inbound.resultIdx];
      const receiptMsg = inbound.frames[inbound.receiptIdx];
      if (coreSupportsP2PMessageReceipt()) {
        assert.strictEqual(receiptMsg.type, 'P2P_MESSAGE_RECEIPT');
      } else {
        assert.strictEqual(
          receiptMsg.type,
          'GenericMessage',
          'install a @fabric/core with P2P_MESSAGE_RECEIPT for typed receipts'
        );
      }

      const resultEnvelope = JSON.parse(resultMsg.body);
      assert.strictEqual(resultEnvelope.method, 'JSONCallResult');
      assert.ok(Array.isArray(resultEnvelope.params));
      assert.strictEqual(resultEnvelope.params.length, 2);
      assert.deepStrictEqual(resultEnvelope.params[1], { ok: true, payload: { hello: 'world' } });

      const receipt = JSON.parse(receiptMsg.body);
      assert.strictEqual(receipt['@type'], 'Receipt');
      assert.strictEqual(receipt['@version'], 1);
      assert.ok(receipt['@actor']);
      assert.ok(receipt['@data']);
    });
  });
});
