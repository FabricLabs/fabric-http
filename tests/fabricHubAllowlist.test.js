'use strict';

const assert = require('assert');
const {
  isAllowedFabricHub,
  assertAllowedFabricHub,
  normalizeHubOrigin
} = require('../functions/fabricHubAllowlist');

describe('@fabric/http fabricHubAllowlist', function () {
  it('allows default HTTPS network hubs and loopback', function () {
    assert.strictEqual(isAllowedFabricHub('https://relay.goon.vc'), true);
    assert.strictEqual(isAllowedFabricHub('https://hub.fabric.pub/sessions'), true);
    assert.strictEqual(isAllowedFabricHub('http://127.0.0.1:3041'), true);
    assert.strictEqual(isAllowedFabricHub('http://localhost:8080'), true);
  });

  it('rejects cleartext production hubs unless explicitly allowlisted', function () {
    assert.strictEqual(isAllowedFabricHub('http://hub.fabric.pub'), false);
    assert.strictEqual(isAllowedFabricHub('http://relay.goon.vc'), false);
    assert.strictEqual(
      isAllowedFabricHub('http://hub.fabric.pub', {
        env: { FABRIC_HUB_ALLOWLIST: 'http://hub.fabric.pub' }
      }),
      true
    );
  });

  it('rejects unknown hubs unless allowlisted via env', function () {
    assert.strictEqual(isAllowedFabricHub('https://evil.example'), false);
    assert.strictEqual(
      isAllowedFabricHub('https://evil.example', {
        env: { FABRIC_HUB_ALLOWLIST: 'https://evil.example' }
      }),
      true
    );
    // Explicit empty overlay must not inherit ambient process.env allowlist.
    const prev = process.env.FABRIC_HUB_ALLOWLIST;
    process.env.FABRIC_HUB_ALLOWLIST = 'https://evil.example';
    try {
      assert.strictEqual(
        isAllowedFabricHub('https://evil.example', { env: {} }),
        false
      );
    } finally {
      if (prev == null) delete process.env.FABRIC_HUB_ALLOWLIST;
      else process.env.FABRIC_HUB_ALLOWLIST = prev;
    }
  });

  it('assertAllowedFabricHub normalizes origin', function () {
    const ok = assertAllowedFabricHub('https://relay.goon.vc/path');
    assert.strictEqual(ok.ok, true);
    assert.strictEqual(ok.hubBase, 'https://relay.goon.vc');
    const bad = assertAllowedFabricHub('https://phishing.test');
    assert.strictEqual(bad.ok, false);
    assert.match(bad.error, /not allowed/);
  });

  it('normalizeHubOrigin rejects non-http(s)', function () {
    assert.strictEqual(normalizeHubOrigin('ftp://x'), null);
  });
});
