'use strict';

const assert = require('assert');

const { normalizeOrigin, originList, webSocketOriginAllowed } = require('../functions/webSocketOrigin');
const { frameAncestorsHeader, attachFrameAncestors } = require('../functions/spaFrameAncestors');

describe('webSocketOrigin', function () {
  it('normalizes absolute origins and drops the rest', function () {
    assert.strictEqual(normalizeOrigin('https://Hub.Example/path'), 'https://hub.example');
    assert.strictEqual(normalizeOrigin('not a url'), '');
    assert.deepStrictEqual([...originList(['https://a.example', 'nope', 'https://a.example/'])], ['https://a.example']);
  });

  it('allows a missing origin, this host, and pinned origins', function () {
    const allowed = originList(['https://app.example']);
    assert.strictEqual(webSocketOriginAllowed({ headers: {} }, allowed), true);
    assert.strictEqual(webSocketOriginAllowed({
      headers: { host: '127.0.0.1:8080', origin: 'http://127.0.0.1:8080' }
    }, allowed), true);
    assert.strictEqual(webSocketOriginAllowed({
      headers: { host: '127.0.0.1:8080', origin: 'https://app.example' }
    }, allowed), true);
    assert.strictEqual(webSocketOriginAllowed({
      headers: { host: '127.0.0.1:8080', origin: 'https://evil.example' }
    }, allowed), false);
    assert.strictEqual(webSocketOriginAllowed({
      headers: { host: '127.0.0.1:8080', origin: 'not a url' }
    }, allowed), false);
  });
});

describe('spaFrameAncestors', function () {
  it('adds frame-ancestors unless the page already set one', function () {
    assert.strictEqual(frameAncestorsHeader(''), "frame-ancestors 'self'");
    assert.strictEqual(frameAncestorsHeader(null), "frame-ancestors 'self'");
    assert.strictEqual(frameAncestorsHeader("default-src 'self'"), "default-src 'self'; frame-ancestors 'self'");
    assert.strictEqual(frameAncestorsHeader("frame-ancestors 'none'"), null);
  });

  it('sets the header when the response becomes HTML, and keeps a page policy', function () {
    const headers = {};
    const res = {
      setHeader (name, value) { headers[String(name).toLowerCase()] = value; },
      getHeader (name) { return headers[String(name).toLowerCase()]; }
    };
    attachFrameAncestors(res);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    assert.strictEqual(headers['content-security-policy'], "frame-ancestors 'self'");
    res.setHeader('Content-Security-Policy', "frame-ancestors https://frames.example");
    assert.strictEqual(headers['content-security-policy'], 'frame-ancestors https://frames.example');
  });
});
