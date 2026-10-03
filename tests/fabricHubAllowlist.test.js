'use strict';

const assert = require('assert');
const {
  isAllowedFabricHub,
  assertAllowedFabricHub,
  normalizeHttpsHostSuffix,
  parseAllowlistToken
} = require('../functions/fabricHubAllowlist');

describe('fabricHubAllowlist', function () {
  it('allows HTTPS network hubs and rejects phishing', function () {
    assert.strictEqual(isAllowedFabricHub('https://hub.fabric.pub'), true);
    assert.strictEqual(isAllowedFabricHub('https://evil.example'), false);
    const bad = assertAllowedFabricHub('https://evil.example');
    assert.strictEqual(bad.ok, false);
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
