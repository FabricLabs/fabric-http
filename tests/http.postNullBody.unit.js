'use strict';

const assert = require('assert');
const { describe, it } = require('mocha');
const HTTPServer = require('../types/server');

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
