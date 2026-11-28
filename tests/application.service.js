'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const net = require('net');
const HTTPServer = require('../types/server');
const Hub = require('../types/hub');
const ApplicationService = require('../services/application');
const { buildApplicationResourceContract } = require('../functions/applicationResourceContract');
const { httpRequest } = require('./helpers/httpRequest');

function ephemeralPort () {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      const port = typeof addr === 'object' && addr ? addr.port : null;
      server.close((err) => (err ? reject(err) : resolve(port)));
    });
    server.on('error', reject);
  });
}

function storePath () {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'fabric-http-application-'));
}

describe('ApplicationService', function () {
  this.timeout(60000);

  it('defines the application contract resources on the one HTTP server', async function () {
    const server = new HTTPServer({
      listen: false,
      port: 1,
      path: storePath(),
      persistent: false
    });
    const application = new ApplicationService();
    await application.bind(server);

    assert.strictEqual(application.bound, true);
    assert.ok(server.resources.has('Session'));
    assert.ok(server.resources.has('Peer'));
    assert.ok(server.resources.has('Entity'));
    assert.strictEqual(server.resources.has('Player'), false);

    const contract = buildApplicationResourceContract(server);
    assert.strictEqual(contract['@type'], 'ApplicationResourceContract');
    assert.strictEqual(contract.resources.Peer.routes.list, '/peers');
    assert.strictEqual(contract.resources.Peer.routes.view, '/peers/:id');
    assert.strictEqual(contract.resources.Session.routes.list, '/sessions');
    assert.strictEqual(contract.resources.Player, undefined);
    assert.strictEqual(contract.resources.Entity.routes.view, '/entities/:id');
    assert.ok(contract.contract && contract.contract.id);
    assert.strictEqual(contract.contract.messageType, 'CONTRACT_PUBLISH');
  });

  it('refuses a second bind', async function () {
    const server = new HTTPServer({ listen: false, port: 1, path: storePath() });
    const application = new ApplicationService();
    await application.bind(server);
    await assert.rejects(() => application.bind(server), /already bound/);
  });

  it('serves the peer roster as the resource verb table', async function () {
    const port = await ephemeralPort();
    const server = new HTTPServer({
      port,
      host: '127.0.0.1',
      hostname: '127.0.0.1',
      path: storePath(),
      listen: true
    });
    await new ApplicationService().bind(server);
    await server.start();
    try {
      const missing = await httpRequest({
        port,
        method: 'POST',
        path: '/peers',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: '{}'
      });
      assert.strictEqual(missing.statusCode, 422);

      const created = await httpRequest({
        port,
        method: 'POST',
        path: '/peers',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({ address: 'hub.fabric.pub:7777' })
      });
      assert.strictEqual(created.statusCode, 303);
      assert.ok(String(created.headers.location || '').startsWith('/peers/'));

      const list = await httpRequest({
        port,
        path: '/peers',
        headers: { accept: 'application/json' }
      });
      assert.strictEqual(list.statusCode, 200);
      const peers = JSON.parse(list.body);
      assert.strictEqual(peers.length, 1);
      assert.strictEqual(peers[0].address, 'hub.fabric.pub:7777');
    } finally {
      await server.stop().catch(() => {});
    }
  });

  it('Hub is a FabricHTTPServer plus the application service', function () {
    const hub = new Hub({ listen: false, port: 1, path: storePath() });
    assert.ok(hub.http instanceof HTTPServer);
    assert.ok(hub.application instanceof ApplicationService);
    assert.strictEqual(hub.express, undefined);
  });
});
