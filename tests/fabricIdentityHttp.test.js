'use strict';

const assert = require('assert');
const Key = require('@fabric/core/types/key');
const Identity = require('@fabric/core/types/identity');
const {
  DESKTOP_LOGIN_PREFIX,
  buildLoginMessage,
  parseDesktopLoginMessage,
  verifyFabricDesktopLoginSignedPayload,
  buildFabricIdentitySignedPayload,
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
    const payload = buildFabricIdentitySignedPayload(ident, message);
    const verified = verifyFabricDesktopLoginSignedPayload({
      ...payload,
      message
    }, { sessionId, origin });
    assert.strictEqual(verified.ok, true);
    assert.strictEqual(payload.pubkeyHex, ident.fabricKey.pubkey);
    assert.strictEqual(payload.identity.xpub, ident.fabricKey.xpub);
    assert.strictEqual(payload.identity.id, String(ident.id));
  });

  it('rejects a half-populated expected session binding', function () {
    const key = new Key();
    const ident = new Identity(key);
    const sessionId = 'ab'.repeat(24);
    const origin = 'https://relay.goon.vc';
    const message = buildLoginMessage(sessionId, origin, 'cd'.repeat(32));
    const payload = buildFabricIdentitySignedPayload(ident, message);
    const onlySid = verifyFabricDesktopLoginSignedPayload({ ...payload, message }, { sessionId });
    const onlyOrigin = verifyFabricDesktopLoginSignedPayload({ ...payload, message }, { origin });
    assert.strictEqual(onlySid.ok, false);
    assert.strictEqual(onlyOrigin.ok, false);
  });

  it('signs from HD Key and from { mnemonic } bag', function () {
    const key = new Key();
    const ident = new Identity(key);
    const message = buildLoginMessage('11'.repeat(24), 'https://hub.fabric.pub', '22'.repeat(32));
    const fromKey = buildFabricIdentitySignedPayload(key, message);
    const fromBag = buildFabricIdentitySignedPayload({ mnemonic: key.mnemonic }, message);
    assert.strictEqual(fromKey.pubkeyHex, ident.fabricKey.pubkey);
    assert.strictEqual(fromBag.pubkeyHex, ident.fabricKey.pubkey);
    assert.strictEqual(fromKey.identity.id, fromBag.identity.id);
  });

  it('signs Passport-style leaf private + fabric-path xpub', function () {
    const master = new Key();
    const ident = new Identity(master);
    const fabric = ident.fabricKey;
    const priv = Buffer.isBuffer(fabric.private)
      ? fabric.private.toString('hex')
      : String(fabric.private);
    const message = buildLoginMessage('33'.repeat(24), 'https://relay.goon.vc', '44'.repeat(32));
    const payload = buildFabricIdentitySignedPayload({
      privateKeyHex: priv,
      xpub: fabric.xpub
    }, message);
    assert.strictEqual(payload.pubkeyHex, fabric.pubkey);
    assert.strictEqual(payload.identity.xpub, fabric.xpub);
    const verified = verifyFabricDesktopLoginSignedPayload({
      ...payload,
      message
    }, { sessionId: '33'.repeat(24), origin: 'https://relay.goon.vc' });
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
