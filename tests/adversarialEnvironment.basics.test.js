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
const {
  clientMayAccessDeviceLink
} = require('../functions/fabricDeviceLinkHttp');

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

  it('lets thin clients poll device-link on allowlisted hubs only', function () {
    const android = {
      socket: { remoteAddress: '203.0.113.9' },
      headers: { origin: 'https://localhost' }
    };
    const passport = {
      socket: { remoteAddress: '203.0.113.9' },
      headers: { origin: 'chrome-extension://abcdefghijklmnop' }
    };
    assert.strictEqual(clientMayAccessDeviceLink(android, 'https://relay.goon.vc'), true);
    assert.strictEqual(clientMayAccessDeviceLink(passport, 'https://hub.fabric.pub'), true);
    assert.strictEqual(clientMayAccessDeviceLink(android, 'https://phish.example'), false);
    assert.strictEqual(clientMayPollDesktopSession(android, 'https://relay.goon.vc'), false);
  });

  it('does not treat path sessionId as a delegation-registry credential', function () {
    const { handleSessionGet } = require('../functions/fabricSiteLoginHttp');
    const token = 'aa'.repeat(24);
    const loginSessionId = 'bb'.repeat(24);
    const hub = {
      _desktopAuthSessions: new Map(),
      _delegationRegistry: new Map([
        [token, {
          origin: 'https://hub.fabric.pub',
          linkedAt: Date.now(),
          label: 'browser',
          identityId: 'id1example',
          sessionId: loginSessionId
        }]
      ]),
      getDelegationSessionById (id) {
        const row = this._delegationRegistry.get(id);
        if (!row) return null;
        return { ok: true, kind: 'delegation', id, origin: row.origin, identityId: row.identityId };
      }
    };
    function mockRes () {
      const out = { statusCode: 0, body: null };
      return {
        out,
        setHeader () {},
        status (code) { out.statusCode = code; return this; },
        send (body) { out.body = body; return this; }
      };
    }
    const unauth = mockRes();
    handleSessionGet(hub, {
      params: { sessionId: token },
      headers: { accept: 'application/json' }
    }, unauth);
    assert.strictEqual(unauth.out.statusCode, 404);

    const authed = mockRes();
    handleSessionGet(hub, {
      params: { sessionId: token },
      headers: { accept: 'application/json', authorization: 'Bearer ' + token }
    }, authed);
    assert.strictEqual(authed.out.statusCode, 200);
    const parsed = JSON.parse(authed.out.body);
    assert.strictEqual(parsed.ok, true);
    assert.strictEqual(parsed.kind, 'delegation');
    assert.strictEqual(parsed.identityId, 'id1example');
  });
});
