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
});
