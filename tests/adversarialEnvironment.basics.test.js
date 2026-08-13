'use strict';

/**
 * Basics tied to SECURITY.md § Adversarial environment.
 */

const assert = require('assert');
const {
  isAllowedFabricHub,
  assertAllowedFabricHub,
  normalizeHubOrigin
} = require('../functions/fabricHubAllowlist');
const {
  isLocalRequest,
  requestHasProxyForwardHeaders,
  clientMayPollDesktopSession
} = require('../functions/fabricSiteLoginVerify');

describe('adversarialEnvironment.basics (@fabric/http)', function () {
  it('rejects phishing hub origins for login/link completion', function () {
    assert.strictEqual(isAllowedFabricHub('https://evil.example'), false);
    assert.strictEqual(isAllowedFabricHub('https://evil.example/sessions'), false);
    const bad = assertAllowedFabricHub('https://phishing.test');
    assert.strictEqual(bad.ok, false);
    assert.match(String(bad.error || ''), /not allowed/i);
  });

  it('allows known network hubs and loopback only by default', function () {
    assert.strictEqual(isAllowedFabricHub('https://hub.fabric.pub'), true);
    assert.strictEqual(isAllowedFabricHub('http://127.0.0.1:8080'), true);
    assert.strictEqual(normalizeHubOrigin('ftp://not-http'), null);
  });

  it('does not treat proxied loopback peers as local for Origin bypass', function () {
    const direct = {
      socket: { remoteAddress: '127.0.0.1' },
      headers: {}
    };
    assert.strictEqual(isLocalRequest(direct), true);
    assert.strictEqual(requestHasProxyForwardHeaders(direct), false);

    const viaCaddy = {
      socket: { remoteAddress: '127.0.0.1' },
      headers: { 'x-forwarded-for': '203.0.113.9' }
    };
    assert.strictEqual(requestHasProxyForwardHeaders(viaCaddy), true);
    assert.strictEqual(isLocalRequest(viaCaddy), false);
  });

  it('shares one Origin poll gate across site-login and device-link', function () {
    const origin = 'https://hub.example';
    const remote = { socket: { remoteAddress: '203.0.113.9' }, headers: {} };
    assert.strictEqual(clientMayPollDesktopSession(remote, origin), false);
    assert.strictEqual(clientMayPollDesktopSession({
      socket: { remoteAddress: '203.0.113.9' },
      headers: { origin }
    }, origin), true);
    assert.strictEqual(clientMayPollDesktopSession({
      socket: { remoteAddress: '203.0.113.9' },
      headers: { origin: 'https://evil.example' }
    }, origin), false);
    assert.strictEqual(clientMayPollDesktopSession({
      socket: { remoteAddress: '203.0.113.9' },
      headers: { 'sec-fetch-site': 'same-origin', host: 'hub.example' }
    }, origin), true);
    assert.strictEqual(clientMayPollDesktopSession({
      socket: { remoteAddress: '127.0.0.1' },
      headers: {}
    }, origin), true);
  });
});
