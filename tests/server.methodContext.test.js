'use strict';

const assert = require('assert');
const HTTPServer = require('../types/server');

describe('HTTPServer withContext connection', function () {
  it('passes the calling connection to withContext methods, null without one', async function () {
    const server = new HTTPServer({ listen: false });
    server._registerMethod('Who', (context, x) => ({ connection: context.connection, x }), { withContext: true });
    const socket = { id: 'ws-1' };
    const viaWs = await server._handleCall({ method: 'Who', params: [7], _connection: socket });
    assert.strictEqual(viaWs.connection, socket);
    assert.strictEqual(viaWs.x, 7);
    const viaHttp = await server._handleCall({ method: 'Who', params: [8] });
    assert.strictEqual(viaHttp.connection, null);
  });
});
