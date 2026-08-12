'use strict';

const assert = require('assert');
const {
  isHttpSharedModeEnabled,
  resolveHttpListenHost
} = require('../functions/httpSharedMode');

describe('@fabric/http httpSharedMode', function () {
  it('treats common truthy persisted shapes as shared', function () {
    assert.strictEqual(isHttpSharedModeEnabled(true), true);
    assert.strictEqual(isHttpSharedModeEnabled(1), true);
    assert.strictEqual(isHttpSharedModeEnabled('true'), true);
    assert.strictEqual(isHttpSharedModeEnabled('1'), true);
    assert.strictEqual(isHttpSharedModeEnabled(' YES '), true);
  });

  it('treats falsey and unknown as not shared', function () {
    assert.strictEqual(isHttpSharedModeEnabled(false), false);
    assert.strictEqual(isHttpSharedModeEnabled(0), false);
    assert.strictEqual(isHttpSharedModeEnabled('false'), false);
    assert.strictEqual(isHttpSharedModeEnabled(undefined), false);
    assert.strictEqual(isHttpSharedModeEnabled(null), false);
  });

  it('resolveHttpListenHost defaults and overrides', function () {
    assert.strictEqual(resolveHttpListenHost({ mode: 'relay', env: {} }), '127.0.0.1');
    assert.strictEqual(resolveHttpListenHost({ mode: 'relay', httpSharedMode: true, env: {} }), '0.0.0.0');
    assert.strictEqual(resolveHttpListenHost({ mode: 'server', env: {} }), '0.0.0.0');
    assert.strictEqual(resolveHttpListenHost({
      mode: 'relay',
      httpSharedMode: false,
      env: { FABRIC_HUB_INTERFACE: '192.168.1.10' }
    }), '192.168.1.10');
    assert.strictEqual(resolveHttpListenHost({
      mode: 'relay',
      env: { FABRIC_HUB_INTERFACE: '65.21.231.149', FABRIC_HTTP_INTERFACE: '192.168.1.10' }
    }), '65.21.231.149');
    assert.strictEqual(resolveHttpListenHost({
      mode: 'server',
      host: '127.0.0.1',
      env: {}
    }), '127.0.0.1');
    assert.strictEqual(resolveHttpListenHost({
      mode: 'relay',
      host: '127.0.0.1',
      env: { FABRIC_HUB_INTERFACE: '0.0.0.0' }
    }), '127.0.0.1');
  });
});
