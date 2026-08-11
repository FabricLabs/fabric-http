'use strict';

const assert = require('assert');
const Key = require('@fabric/core/types/key');
const Identity = require('@fabric/core/types/identity');
const {
  DESKTOP_LOGIN_PREFIX,
  buildLoginMessage,
  parseDesktopLoginMessage,
  verifyFabricDesktopLoginSignedPayload,
  originsMatchForDesktopSession
} = require('../functions/fabricSiteLoginVerify');
const { parseFabricLoginUrl } = require('../functions/fabricProtocolLogin');
const { parseFabricDeviceLinkUrl } = require('../functions/fabricDeviceLinkProtocol');
const {
  buildDeviceLinkMessage,
  parseDeviceLinkMessage
} = require('../functions/fabricDeviceLinkMessages');

describe('@fabric/http identity HTTP', function () {
  it('builds and parses site-login challenges', function () {
    const msg = buildLoginMessage('ab'.repeat(24), 'https://relay.goon.vc', 'cd'.repeat(32));
    assert.ok(msg.startsWith(DESKTOP_LOGIN_PREFIX + ':'));
    const parsed = parseDesktopLoginMessage(msg);
    assert.strictEqual(parsed.sessionId, 'ab'.repeat(24));
    assert.strictEqual(parsed.origin, 'https://relay.goon.vc');
  });

  it('verifies a client-signed login payload', function () {
    const key = new Key();
    const ident = new Identity(key);
    const sessionId = 'ab'.repeat(24);
    const origin = 'https://relay.goon.vc';
    const nonce = 'cd'.repeat(32);
    const message = buildLoginMessage(sessionId, origin, nonce);
    const signature = Buffer.from(key.signSchnorr(Buffer.from(message, 'utf8'))).toString('hex');
    const verified = verifyFabricDesktopLoginSignedPayload({
      signature,
      pubkeyHex: key.pubkey,
      message,
      identity: { id: ident.id, xpub: key.xpub }
    }, { sessionId, origin });
    assert.strictEqual(verified.ok, true);
  });

  it('parses fabric://login and fabric://link with allowlist', function () {
    const sid = 'ab'.repeat(24);
    const login = parseFabricLoginUrl(`fabric://login?sessionId=${sid}&hub=${encodeURIComponent('https://hub.fabric.pub')}`);
    assert.strictEqual(login.ok, true);
    const bad = parseFabricLoginUrl(`fabric://login?sessionId=${sid}&hub=${encodeURIComponent('https://evil.example')}`);
    assert.strictEqual(bad.ok, false);
    const link = parseFabricDeviceLinkUrl(`fabric://link?sessionId=${sid}&hub=${encodeURIComponent('https://relay.goon.vc')}`);
    assert.strictEqual(link.ok, true);
    assert.strictEqual(link.kind, 'link');
  });

  it('builds device-link messages', function () {
    const msg = buildDeviceLinkMessage('aa'.repeat(32), 'id1a', 'id1b', 'phone');
    const parsed = parseDeviceLinkMessage(msg);
    assert.strictEqual(parsed.initiatorId, 'id1a');
    assert.strictEqual(parsed.responderId, 'id1b');
  });

  it('matches loopback origins across localhost/127.0.0.1', function () {
    assert.strictEqual(
      originsMatchForDesktopSession('http://127.0.0.1:8080', 'http://localhost:8080'),
      true
    );
  });
});
