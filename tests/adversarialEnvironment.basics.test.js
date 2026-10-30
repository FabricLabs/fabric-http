'use strict';

/**
 * Basics tied to SECURITY.md § Adversarial environment.
 */

const assert = require('assert');
const {
  DEFAULT_FABRIC_HUB_ORIGINS,
  isAllowedFabricHub,
  assertAllowedFabricHub,
  normalizeHubOrigin
} = require('../functions/fabricHubAllowlist');
const {
  isLocalRequest,
  requestHasProxyForwardHeaders,
  clientMayPollSession
} = require('../functions/httpRequestTrust');
const Key = require('@fabric/core/types/key');
const delegation = require('@fabric/core/functions/delegation');
const { readLinkInvitation } = require('../functions/fabricDelegationClient');
const { checkDelegateCaller } = require('../functions/fabricDelegate');

describe('adversarialEnvironment.basics (@fabric/http)', function () {
  it('rejects phishing hub origins for login/link completion', function () {
    assert.strictEqual(isAllowedFabricHub('https://evil.example'), false);
    assert.strictEqual(isAllowedFabricHub('https://evil.example/sessions'), false);
    const bad = assertAllowedFabricHub('https://phishing.test');
    assert.strictEqual(bad.ok, false);
    assert.match(String(bad.error || ''), /not allowed/i);
  });

  it('allows known network hubs and loopback only by default', function () {
    assert.strictEqual(isAllowedFabricHub(DEFAULT_FABRIC_HUB_ORIGINS[0]), true);
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

  it('gates session polls on Origin or Referer, never on Host', function () {
    const origin = 'https://hub.example';
    const remote = { socket: { remoteAddress: '203.0.113.9' }, headers: {} };
    assert.strictEqual(clientMayPollSession(remote, origin), false);
    assert.strictEqual(clientMayPollSession({
      socket: { remoteAddress: '203.0.113.9' },
      headers: { origin }
    }, origin), true);
    assert.strictEqual(clientMayPollSession({
      socket: { remoteAddress: '203.0.113.9' },
      headers: { origin: 'https://evil.example' }
    }, origin), false);
    assert.strictEqual(clientMayPollSession({
      socket: { remoteAddress: '203.0.113.9' },
      headers: { 'sec-fetch-site': 'same-origin', host: 'hub.example' }
    }, origin), false);
    assert.strictEqual(clientMayPollSession({
      socket: { remoteAddress: '203.0.113.9' },
      headers: { referer: 'https://hub.example/devices' }
    }, origin), true);
    assert.strictEqual(clientMayPollSession({
      socket: { remoteAddress: '127.0.0.1' },
      headers: {}
    }, origin), true);
  });

  it('pairs only through rendezvous on the allowlist', function () {
    const key = new Key();
    const good = delegation.createLinkOffer({ origin: DEFAULT_FABRIC_HUB_ORIGINS[0] }, key);
    const phish = delegation.createLinkOffer({ origin: 'https://phish.example' }, key);
    assert.strictEqual(readLinkInvitation(good.uri).ok, true);
    assert.strictEqual(readLinkInvitation(phish.uri).ok, false);
  });

  it('answers delegation requests on loopback from extensions only', function () {
    const direct = (headers) => ({ socket: { remoteAddress: '127.0.0.1' }, headers: Object.assign({ host: '127.0.0.1:8080' }, headers) });
    assert.strictEqual(checkDelegateCaller(direct({ origin: 'https://evil.example' })).ok, false);
    assert.strictEqual(checkDelegateCaller(direct({ origin: 'moz-extension://0b5c2a4e-1111-2222-3333-444455556666', 'x-forwarded-for': '203.0.113.9' })).ok, false);
    assert.strictEqual(checkDelegateCaller(direct({ origin: 'moz-extension://0b5c2a4e-1111-2222-3333-444455556666', host: 'evil.example' })).status, 421);
    assert.strictEqual(checkDelegateCaller(direct({ origin: 'moz-extension://0b5c2a4e-1111-2222-3333-444455556666' })).ok, true);
  });
});
