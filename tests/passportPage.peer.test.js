'use strict';

const assert = require('assert');
const { MessageChannel } = require('worker_threads');
const { connectPeer, callPeer, closePeer, probePassportPeer, fetchAsPeer, PASSPORT_PEER_PROTOCOL } = require('../functions/passportPage');

const ORIGIN = 'https://site.example';

function fakeWindow (passport) {
  const posted = [];
  return {
    posted,
    MessageChannel,
    location: { origin: ORIGIN },
    postMessage (data, targetOrigin, transfer) {
      posted.push({ data, targetOrigin, transfer });
      if (passport) setImmediate(() => passport(data, transfer && transfer[0]));
    }
  };
}

describe('@fabric/http Passport page helper: peer sessions', function () {
  it('detects peer sessions from the hello answer, so an older Passport is never asked', async function () {
    const hello = (extra) => fakeWindow((data, port) => { port.postMessage(Object.assign({ type: 'PASSPORT_HELLO', v: 2 }, extra)); port.close(); });
    assert.strictEqual(await probePassportPeer(hello({ peer: 3 })), true);
    assert.strictEqual(await probePassportPeer(hello({})), false);
    assert.strictEqual(await probePassportPeer(fakeWindow(null), { timeoutMs: 20 }), false);
  });

  it('asks Passport to connect to a peer, with ws endpoints only, and reads the session from the port', async function () {
    const session = { sessionId: 'ab'.repeat(32), peer: '02' + 'cd'.repeat(32), identity: { id: 'id', pubkey: '03' + 'ef'.repeat(32) }, expiresAt: Date.now() + 1000 };
    const win = fakeWindow((data, port) => {
      assert.strictEqual(data.source, 'fabric-site');
      assert.strictEqual(data.type, 'PASSPORT_PEER_CONNECT');
      assert.strictEqual(data.v, PASSPORT_PEER_PROTOCOL);
      assert.deepStrictEqual(data.endpoints, ['wss://hub.example/']);
      assert.deepStrictEqual(data.request, ['wallet']);
      port.postMessage({ type: 'PASSPORT_PEER_SESSION', ok: true, session });
      port.close();
    });
    const result = await connectPeer(win, { endpoints: ['wss://hub.example/', 'ftp://not-a-peer.example', 'javascript:alert(1)'], request: ['wallet'] });
    assert.deepStrictEqual(result, { ok: true, session });
    assert.strictEqual(win.posted[0].targetOrigin, ORIGIN);
    assert.strictEqual(win.posted[0].transfer.length, 1);
    assert.deepStrictEqual(await connectPeer(win, { endpoints: ['ftp://x.example'] }), { ok: false, error: 'no endpoints' });
  });

  it('fetches as a peer session with a header Passport signs for that one request', async function () {
    const sent = [];
    const win = fakeWindow((data, port) => {
      assert.strictEqual(data.type, 'PASSPORT_PEER_AUTHORIZE');
      assert.strictEqual(data.url, 'https://site.example/api/items?x=1');
      assert.strictEqual(data.method, 'POST');
      assert.strictEqual(data.body, '{"a":1}');
      port.postMessage({ type: 'PASSPORT_PEER_AUTHORIZATION', ok: true, header: 'fabric:signed' });
      port.close();
    });
    win.location.href = 'https://site.example/page';
    const fetchImpl = async (url, init) => { sent.push({ url, init }); return { ok: true }; };
    await fetchAsPeer(win, { sessionId: 's', url: '/api/items?x=1', init: { method: 'POST', body: '{"a":1}', headers: { 'Content-Type': 'application/json' } }, fetch: fetchImpl });
    assert.strictEqual(sent[0].url, 'https://site.example/api/items?x=1');
    assert.strictEqual(sent[0].init.headers['X-Fabric-Request'], 'fabric:signed');
    assert.strictEqual(sent[0].init.headers['Content-Type'], 'application/json');
    const refused = fakeWindow((data, port) => { port.postMessage({ ok: false, error: 'not_your_session' }); port.close(); });
    refused.location.href = 'https://site.example/';
    await assert.rejects(fetchAsPeer(refused, { sessionId: 's', url: '/x', fetch: fetchImpl }), /not_your_session/);
  });

  it('calls and closes through Passport, passing on refusals', async function () {
    const win = fakeWindow((data, port) => {
      if (data.type === 'PASSPORT_PEER_CALL') {
        if (data.method === 'Nope') port.postMessage({ ok: false, error: 'not_your_session' });
        else port.postMessage({ type: 'PASSPORT_PEER_RESULT', ok: true, result: { method: data.method, params: data.params } });
      } else if (data.type === 'PASSPORT_PEER_CLOSE') {
        port.postMessage({ type: 'PASSPORT_PEER_CLOSED', ok: true });
      }
      port.close();
    });
    assert.deepStrictEqual(await callPeer(win, { sessionId: 's', method: 'Whoami', params: [1] }), { ok: true, result: { method: 'Whoami', params: [1] } });
    assert.deepStrictEqual(await callPeer(win, { sessionId: 's', method: 'Nope' }), { ok: false, error: 'not_your_session' });
    assert.deepStrictEqual(await callPeer(win, { method: 'Whoami' }), { ok: false, error: 'sessionId and method required' });
    assert.deepStrictEqual(await closePeer(win, { sessionId: 's' }), { ok: true });
    assert.deepStrictEqual(await callPeer(fakeWindow(null), { sessionId: 's', method: 'Whoami', timeoutMs: 20 }), { ok: false, error: 'timeout' });
  });
});
