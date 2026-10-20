'use strict';

const assert = require('assert');
const {
  isAllowedFabricHub,
  assertAllowedFabricHub,
  normalizeHubOrigin,
  normalizeHttpsHostSuffix,
  parseAllowlistToken
} = require('../functions/fabricHubAllowlist');

describe('fabricHubAllowlist', function () {
  it('allows HTTPS network hubs and loopback, and rejects phishing', function () {
    assert.strictEqual(isAllowedFabricHub('https://hub.fabric.pub'), true);
    assert.strictEqual(isAllowedFabricHub('https://hub.fabric.pub/sessions'), true);
    assert.strictEqual(isAllowedFabricHub('https://hub.goon.vc'), true);
    assert.strictEqual(isAllowedFabricHub('https://relay.goon.vc'), true);
    assert.strictEqual(isAllowedFabricHub('http://127.0.0.1:3041'), true);
    assert.strictEqual(isAllowedFabricHub('http://localhost:8080'), true);
    assert.strictEqual(isAllowedFabricHub('https://evil.example'), false);
    const bad = assertAllowedFabricHub('https://evil.example');
    assert.strictEqual(bad.ok, false);
    assert.match(bad.error, /not allowed/);
  });

  it('rejects cleartext production hubs unless explicitly allowlisted', function () {
    assert.strictEqual(isAllowedFabricHub('http://hub.fabric.pub'), false);
    assert.strictEqual(isAllowedFabricHub('http://relay.goon.vc'), false);
    assert.strictEqual(isAllowedFabricHub('http://hub.goon.vc'), false);
    assert.strictEqual(
      isAllowedFabricHub('http://hub.fabric.pub', {
        env: { FABRIC_HUB_ALLOWLIST: 'http://hub.fabric.pub' }
      }),
      true
    );
  });

  it('reads FABRIC_HUB_ALLOWLIST from opts.env, not process.env, when env is given', function () {
    const prev = process.env.FABRIC_HUB_ALLOWLIST;
    process.env.FABRIC_HUB_ALLOWLIST = 'https://evil.example';
    try {
      assert.strictEqual(isAllowedFabricHub('https://evil.example', { env: {} }), false);
    } finally {
      if (prev == null) delete process.env.FABRIC_HUB_ALLOWLIST;
      else process.env.FABRIC_HUB_ALLOWLIST = prev;
    }
  });

  it('assertAllowedFabricHub normalizes to the origin; normalizeHubOrigin rejects non-http(s)', function () {
    const ok = assertAllowedFabricHub('https://relay.goon.vc/path');
    assert.strictEqual(ok.ok, true);
    assert.strictEqual(ok.hubBase, 'https://relay.goon.vc');
    assert.strictEqual(normalizeHubOrigin('ftp://x'), null);
  });

  it('does not trust CDN preview hosts by default', function () {
    assert.strictEqual(
      isAllowedFabricHub('https://pub-fabric-hub-git-feature-rsi-fabric-labs.vercel.app'),
      false
    );
  });

  it('rejects shared-platform and public-suffix wildcards; allows exact preview origins', function () {
    const preview = 'https://pub-fabric-hub-git-feature-rsi-fabric-labs.vercel.app';
    assert.strictEqual(normalizeHttpsHostSuffix('*.vercel.app'), null);
    assert.strictEqual(normalizeHttpsHostSuffix('*.co.uk'), null);
    assert.strictEqual(parseAllowlistToken('*.vercel.app'), null);
    assert.strictEqual(
      isAllowedFabricHub(preview, { env: { FABRIC_HUB_ALLOWLIST: '*.vercel.app' } }),
      false
    );
    assert.strictEqual(
      isAllowedFabricHub(preview, { extra: ['*.vercel.app'] }),
      false
    );
    assert.strictEqual(
      isAllowedFabricHub(preview, { extra: [preview] }),
      true
    );
  });

  it('allows operator-controlled HTTPS host suffixes when explicitly listed', function () {
    const preview = 'https://feature.hub.example.com';
    assert.ok(normalizeHttpsHostSuffix('*.hub.example.com'));
    assert.strictEqual(
      isAllowedFabricHub(preview, { env: { FABRIC_HUB_ALLOWLIST: '*.hub.example.com' } }),
      true
    );
    assert.strictEqual(
      isAllowedFabricHub(preview, { extra: ['*.example.com'] }),
      true
    );
    assert.strictEqual(
      isAllowedFabricHub('http://evil.example.com', { extra: ['*.example.com'] }),
      false
    );
    assert.strictEqual(
      isAllowedFabricHub('https://evil.other', { extra: ['*.example.com'] }),
      false
    );
    // Operator domain under a multi-part public suffix is fine; the bare PSL is not.
    assert.ok(normalizeHttpsHostSuffix('*.myorg.co.uk'));
    assert.strictEqual(
      isAllowedFabricHub('https://a.myorg.co.uk', { extra: ['*.myorg.co.uk'] }),
      true
    );
  });

  it('rejects short public-suffix wildcards', function () {
    assert.strictEqual(normalizeHttpsHostSuffix('*.com'), null);
    assert.strictEqual(normalizeHttpsHostSuffix('*.app'), null);
    assert.strictEqual(parseAllowlistToken('*.com'), null);
    assert.strictEqual(
      isAllowedFabricHub('https://evil.com', { extra: ['*.com'] }),
      false
    );
  });

  it('allows exact origins via FABRIC_HUB_ALLOWLIST', function () {
    const preview = 'https://my-preview.example.com';
    assert.strictEqual(
      isAllowedFabricHub(preview, {
        env: { FABRIC_HUB_ALLOWLIST: preview }
      }),
      true
    );
  });
});
