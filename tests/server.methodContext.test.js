'use strict';

const assert = require('assert');
const HTTPServer = require('../types/server');

describe('HTTPServer withContext connection', function () {
  this.timeout(10000);

  it('passes the calling connection to withContext methods, null without one', async function () {
    const server = new HTTPServer({ listen: false });
    server._registerMethod('Who', (context, x) => ({ connection: context.connection, x }), { withContext: true });
    const socket = { id: 'ws-1' };
    const viaWs = await server._handleCall({ method: 'Who', params: [7], [HTTPServer.CALL_CONTEXT]: { connection: socket } });
    assert.strictEqual(viaWs.connection, socket);
    assert.strictEqual(viaWs.x, 7);
    const viaHttp = await server._handleCall({ method: 'Who', params: [8] });
    assert.strictEqual(viaHttp.connection, null);
  });

  it('ignores passport and connection fields a client put in the call', async function () {
    const server = new HTTPServer({ listen: false });
    server._registerMethod('Whoami', (context) => ({ passport: context.passport, connection: context.connection }), { withContext: true });
    const forged = JSON.parse(JSON.stringify({
      method: 'Whoami',
      passport: { identity: { pubkey: '02'.padEnd(66, 'a') } },
      _connection: { id: 'forged' }
    }));
    const out = await server._handleCall(Object.assign({}, forged, { _fabricTransportAuthorized: true }));
    assert.strictEqual(out.passport, null);
    assert.strictEqual(out.connection, null);
  });

  it('passes a session the server vouched for', async function () {
    const server = new HTTPServer({ listen: false });
    server._registerMethod('Whoami', (context) => context.passport, { withContext: true });
    const session = { sessionId: 's1', identity: { pubkey: '03'.padEnd(66, 'b') } };
    const out = await server._handleCall({ method: 'Whoami', [HTTPServer.CALL_CONTEXT]: { passport: session } });
    assert.strictEqual(out, session);
  });

  it('does not let a GenericMessage call claim a Passport session', async function () {
    const server = new HTTPServer({ listen: false });
    let seen = 'unset';
    server._registerMethod('Whoami', (context) => { seen = context.passport; return null; }, { withContext: true });
    server.on('call', server._handleCall.bind(server));
    const baseCall = JSON.parse('{"method":"Whoami","passport":{"identity":{"pubkey":"02aa"}}}');
    server.emit('call', Object.assign({}, baseCall, { _fabricTransportAuthorized: true }));
    assert.strictEqual(seen, null);
  });
});
