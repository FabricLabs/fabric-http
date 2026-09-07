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

  it('allows HTTPS host suffixes only when explicitly listed', function () {
    const preview = 'https://pub-fabric-hub-git-feature-rsi-fabric-labs.vercel.app';
    assert.strictEqual(
      isAllowedFabricHub(preview, { env: { FABRIC_HUB_ALLOWLIST: '*.vercel.app' } }),
      true
    );
    assert.strictEqual(
      isAllowedFabricHub(preview, { extra: ['*.vercel.app'] }),
      true
    );
    assert.strictEqual(
      isAllowedFabricHub('http://evil.vercel.app', { extra: ['*.vercel.app'] }),
      false
    );
    assert.strictEqual(
      isAllowedFabricHub('https://evil.example', { extra: ['*.vercel.app'] }),
      false
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
