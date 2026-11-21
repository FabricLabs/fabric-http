'use strict';

const assert = require('assert');
const Key = require('@fabric/core/types/key');
const Message = require('@fabric/core/types/message');
const { encodeFabricUri } = require('@fabric/core/functions/fabricUri');
const {
  PASSPORT_REQUEST_CONTRACT,
  createPeerRequest,
  readPeerRequest
} = require('../functions/passportPeerRequest');

const NOW = 1_800_000_000_000;
const PEER = new Key();
const OTHER = new Key();
const SESSION = new Key();
const SESSION_ID = 'ee'.repeat(32);

describe('@fabric/http functions/passportPeerRequest', function () {
  it('binds one HTTP request: method, target, body, peer, and time', function () {
    const body = JSON.stringify({ text: 'o7' });
    const r = createPeerRequest({ sessionId: SESSION_ID, peer: PEER.pubkey, method: 'post', target: '/services/messages?room=1', body, now: NOW }, SESSION);
    const expect = { peer: PEER.pubkey, method: 'POST', target: '/services/messages?room=1', body: Buffer.from(body), now: NOW + 1000 };
    const ok = readPeerRequest(r.uri, expect);
    assert.strictEqual(ok.ok, true, ok.error);
    assert.strictEqual(ok.sessionId, SESSION_ID);
    assert.strictEqual(ok.nonce, r.nonce);
    assert.strictEqual(ok.author, SESSION.pubkey.slice(2));
    assert.match(readPeerRequest(r.uri, Object.assign({}, expect, { method: 'DELETE' })).error, /method/);
    assert.match(readPeerRequest(r.uri, Object.assign({}, expect, { target: '/services/messages?room=2' })).error, /target/);
    assert.match(readPeerRequest(r.uri, Object.assign({}, expect, { body: '{"text":"pay me"}' })).error, /body/);
    assert.match(readPeerRequest(r.uri, Object.assign({}, expect, { peer: OTHER.pubkey })).error, /another peer/);
    assert.match(readPeerRequest(r.uri, Object.assign({}, expect, { now: NOW + 5 * 60 * 1000 })).error, /expired/);
    const empty = createPeerRequest({ sessionId: SESSION_ID, peer: PEER.pubkey, method: 'GET', target: '/', now: NOW }, SESSION);
    assert.strictEqual(readPeerRequest(empty.uri, { peer: PEER.pubkey, method: 'GET', target: '/', now: NOW }).ok, true);
  });

  it('is a core CONTRACT_MESSAGE under its own contract id, signed by the session key', function () {
    const r = createPeerRequest({ sessionId: SESSION_ID, peer: PEER.pubkey, method: 'GET', target: '/x', now: NOW }, SESSION);
    assert.strictEqual(r.message.type, 'CONTRACT_MESSAGE');
    const fields = r.message.toFields();
    assert.strictEqual(fields.contract, PASSPORT_REQUEST_CONTRACT);
    assert.strictEqual(fields.recipient, PEER.pubkey);
    assert.strictEqual(fields.ref, SESSION_ID);
    // Another contract's message is not a request authorization, even if signed.
    const other = Message.fromFields('CONTRACT_MESSAGE', Object.assign({}, fields, { contract: 'aa'.repeat(32) })).signWithKey(SESSION);
    assert.match(readPeerRequest(encodeFabricUri(other), { peer: PEER.pubkey, method: 'GET', target: '/x', now: NOW }).error, /not a Passport request/);
    const unsigned = Message.fromFields('CONTRACT_MESSAGE', fields);
    assert.strictEqual(readPeerRequest(encodeFabricUri(unsigned), { peer: PEER.pubkey, method: 'GET', target: '/x', now: NOW }).ok, false);
  });

  it('refuses targets that are not a path', function () {
    for (const target of ['https://evil.example/', '//evil.example/x', '/a b', '/x#frag', '']) {
      assert.throws(() => createPeerRequest({ sessionId: SESSION_ID, peer: PEER.pubkey, method: 'GET', target }, SESSION), /target/);
    }
  });
});
