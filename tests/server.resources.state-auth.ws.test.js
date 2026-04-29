'use strict';

const assert = require('assert');
const net = require('net');
const os = require('os');
const path = require('path');
const WebSocket = require('ws');
const Message = require('@fabric/core/types/message');

const HTTPServer = require('../types/server');
const auth = require('../middlewares/auth');
const { httpRequest } = require('./helpers/httpRequest');

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

describe('@fabric/http server resource state/auth/ws wiring', function () {
  this.timeout(20000);

  it('keeps resource collections in canonical local state/store', async function () {
    const port = await ephemeralPort();
    const server = new HTTPServer({
      port,
      host: '127.0.0.1',
      interface: '127.0.0.1',
      hostname: '127.0.0.1',
      listen: true,
      accessLog: path.join(os.tmpdir(), `fabric-http-state-${port}.log`),
      resources: {
        Person: {
          components: { list: 'person-list', view: 'person-view' }
        }
      }
    });

    await server.start();
    try {
      assert.ok(Object.prototype.hasOwnProperty.call(server._state.content, 'people'));

      const post = await httpRequest({
        port,
        method: 'POST',
        path: '/people',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ name: 'Alice' })
      });
      assert.strictEqual(post.statusCode, 303);

      const collectionFromStore = await server.localStore._GET('/people');
      assert.ok(collectionFromStore && typeof collectionFromStore === 'object');

      const read = await httpRequest({
        port,
        method: 'GET',
        path: '/people',
        headers: { Accept: 'application/json' }
      });
      assert.strictEqual(read.statusCode, 200);
      const body = JSON.parse(read.body);
      assert.ok(body && typeof body === 'object');
      assert.ok(Object.keys(body).length >= 1, 'expected one created person');
    } finally {
      await server.stop();
    }
  });

  it('auto-subscribes websocket connections on resource paths', async function () {
    const port = await ephemeralPort();
    const server = new HTTPServer({
      port,
      host: '127.0.0.1',
      interface: '127.0.0.1',
      hostname: '127.0.0.1',
      listen: true,
      accessLog: path.join(os.tmpdir(), `fabric-http-ws-sub-${port}.log`),
      resources: {
        Person: {
          components: { list: 'person-list', view: 'person-view' }
        }
      }
    });

    await server.start();
    try {
      const observed = await new Promise((resolve, reject) => {
        const ws = new WebSocket(`ws://127.0.0.1:${port}/people`);
        const timer = setTimeout(() => {
          try { ws.close(); } catch (_) {}
          reject(new Error('timed out waiting for PATCH subscription frame'));
        }, 7000);

        ws.on('open', async () => {
          try {
            await httpRequest({
              port,
              method: 'POST',
              path: '/people',
              headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
              body: JSON.stringify({ name: 'Bob' })
            });
          } catch (err) {
            clearTimeout(timer);
            reject(err);
          }
        });

        ws.on('message', (data) => {
          try {
            const msg = Message.fromBuffer(Buffer.isBuffer(data) ? data : Buffer.from(data));
            let payload = null;
            try {
              payload = JSON.parse(msg.body);
            } catch (_) {
              return;
            }
            const isPatchFrame = msg.type === 'PATCH' || (payload && typeof payload === 'object' && payload.path);
            if (!isPatchFrame) return;
            if (payload.path !== '/people') return;
            clearTimeout(timer);
            ws.close();
            resolve(payload);
          } catch (_) {}
        });

        ws.on('error', (err) => {
          clearTimeout(timer);
          reject(err);
        });
      });

      assert.strictEqual(observed.path, '/people');
      assert.ok(observed.value && typeof observed.value === 'object');
    } finally {
      await server.stop();
    }
  });

  it('routes patch events by subscription scope', async function () {
    const port = await ephemeralPort();
    const server = new HTTPServer({
      port,
      host: '127.0.0.1',
      interface: '127.0.0.1',
      hostname: '127.0.0.1',
      listen: true,
      accessLog: path.join(os.tmpdir(), `fabric-http-ws-scope-${port}.log`),
      resources: {
        Document: {
          components: { list: 'document-list', view: 'document-view' }
        }
      }
    });

    await server.start();
    try {
      const rootEvents = [];
      const listEvents = [];
      const itemEvents = [];

      const rootClient = new WebSocket(`ws://127.0.0.1:${port}/`);
      const listClient = new WebSocket(`ws://127.0.0.1:${port}/documents`);
      const itemId = 'foo';
      const itemClient = new WebSocket(`ws://127.0.0.1:${port}/documents/${itemId}`);

      await Promise.all([
        new Promise((resolve, reject) => {
          rootClient.once('open', resolve);
          rootClient.once('error', reject);
        }),
        new Promise((resolve, reject) => {
          listClient.once('open', resolve);
          listClient.once('error', reject);
        }),
        new Promise((resolve, reject) => {
          itemClient.once('open', resolve);
          itemClient.once('error', reject);
        })
      ]);

      const track = (bucket) => (data) => {
        try {
          const msg = Message.fromBuffer(Buffer.isBuffer(data) ? data : Buffer.from(data));
          const payload = JSON.parse(msg.body);
          if (payload && payload.path) bucket.push(payload.path);
        } catch (_) {}
      };

      rootClient.on('message', track(rootEvents));
      listClient.on('message', track(listEvents));
      itemClient.on('message', track(itemEvents));

      await httpRequest({
        port,
        method: 'PUT',
        path: `/documents/${itemId}`,
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ id: itemId, title: 'Scoped document' })
      });

      await new Promise((resolve) => setTimeout(resolve, 300));

      rootClient.close();
      listClient.close();
      itemClient.close();

      assert.ok(rootEvents.includes('/documents/foo'), 'root should receive all changes');
      assert.ok(listEvents.includes('/documents/foo'), 'list subscriber should receive child change');
      assert.ok(itemEvents.includes('/documents/foo'), 'item subscriber should receive exact change');
    } finally {
      await server.stop();
    }
  });

  it('enforces authenticated resource writes when enabled', async function () {
    const port = await ephemeralPort();
    const seed = 'test-seed-for-resource-write-auth';
    const server = new HTTPServer({
      port,
      host: '127.0.0.1',
      interface: '127.0.0.1',
      hostname: '127.0.0.1',
      listen: true,
      seed,
      accessLog: path.join(os.tmpdir(), `fabric-http-auth-${port}.log`),
      security: {
        resourceWriteAuthRequired: true
      },
      resources: {
        Note: {
          components: { list: 'note-list', view: 'note-view' }
        }
      }
    });

    await server.start();
    try {
      const denied = await httpRequest({
        port,
        method: 'POST',
        path: '/notes',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ text: 'no token' })
      });
      assert.strictEqual(denied.statusCode, 401);

      const token = auth.buildBearerToken(seed, { sub: 'test-user', role: 'writer' });
      const allowed = await httpRequest({
        port,
        method: 'POST',
        path: '/notes',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ text: 'authorized' })
      });
      assert.strictEqual(allowed.statusCode, 303);
    } finally {
      await server.stop();
    }
  });
});
