'use strict';

const assert = require('assert');
const { walletPathFromArgv } = require('../functions/cliWalletArgv');

describe('walletPathFromArgv', function () {
  const fallback = '/tmp/default-wallet.json';

  it('returns fallback when argv has no --wallet', function () {
    assert.strictEqual(walletPathFromArgv(['node', 'cli'], fallback), fallback);
  });

  it('reads --wallet=VALUE before Commander parse', function () {
    assert.strictEqual(
      walletPathFromArgv(['node', 'cli', '--wallet=/tmp/custom.json'], fallback),
      '/tmp/custom.json'
    );
  });

  it('reads --wallet VALUE as a separate token', function () {
    assert.strictEqual(
      walletPathFromArgv(['node', 'cli', '--wallet', '/tmp/split.json', 'serve'], fallback),
      '/tmp/split.json'
    );
  });

  it('ignores --wallet after a -- terminator', function () {
    assert.strictEqual(
      walletPathFromArgv(['node', 'cli', '--', '--wallet=/tmp/ignored.json'], fallback),
      fallback
    );
  });

  it('does not treat --wallet --flag as a path', function () {
    assert.strictEqual(
      walletPathFromArgv(['node', 'cli', '--wallet', '--password=x'], fallback),
      fallback
    );
  });

  it('does not treat --wallet -p as a path', function () {
    assert.strictEqual(
      walletPathFromArgv(['node', 'cli', '--wallet', '-p'], fallback),
      fallback
    );
  });

  it('keeps a dash-prefixed filename via --wallet=VALUE', function () {
    assert.strictEqual(
      walletPathFromArgv(['node', 'cli', '--wallet=-secret.json'], fallback),
      '-secret.json'
    );
  });
});
