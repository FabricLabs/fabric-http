'use strict';

const assert = require('assert');
const crypto = require('crypto');

const Token = require('@fabric/core/types/token');
const HTTPServer = require('../types/server');
const authMiddleware = require('../middlewares/auth');

function makeBearerToken (secret, payload = {}) {
  const header = { alg: 'SHA256', typ: 'JWT' };
  const encodedHeader = Token.base64UrlEncode(JSON.stringify(header));
  const encodedPayload = Token.base64UrlEncode(JSON.stringify(payload));
  const signatureHex = crypto
    .createHash('sha256')
    .update(`${encodedHeader}.${encodedPayload}.${secret}`)
    .digest('hex');
  const signature = Token.base64UrlEncode(signatureHex);
  return `${encodedHeader}.${encodedPayload}.${signature}`;
}

describe('@fabric/http security hardening', function () {
  it('does not authenticate bearer token when token secret is unset', function (done) {
    const knownFallback = '97eb31a7dc28667402863f4db08de04981a3902670d36e6ea4528dfec20fb4c4';
    const forged = makeBearerToken(knownFallback, { role: 'admin' });
    const req = { headers: {}, token: forged };
    const res = {};
    const ctx = { settings: { verbosity: 0 } };

    authMiddleware.call(ctx, req, res, () => {
      assert.strictEqual(req.authenticated, false);
      assert.strictEqual(req.tokenError, 'missing_secret');
      done();
    });
  });

  it('accepts websocket client token when it matches configured secret', function () {
    const server = new HTTPServer({
      listen: false,
      websocket: { requireClientToken: true, clientToken: 'super-secret' }
    });
    const ok = server._verifyWebSocketClient({
      req: { url: '/?token=super-secret', headers: {} }
    });
    assert.strictEqual(ok, true);
  });

  it('rejects websocket client token when it does not match configured secret', function () {
    const server = new HTTPServer({
      listen: false,
      websocket: { requireClientToken: true, clientToken: 'super-secret' }
    });
    const ok = server._verifyWebSocketClient({
      req: { url: '/?token=wrong', headers: {} }
    });
    assert.strictEqual(ok, false);
  });
});
