'use strict';

const assert = require('assert');
const { MessageChannel } = require('worker_threads');
const {
  PASSPORT_MARKER,
  passportInstalled,
  passportStatus,
  askPassport,
  signInWithPassport
} = require('../functions/passportPage');

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

describe('@fabric/http Passport page helper', function () {
  it('sees Passport only when the marker says protocol 2', function () {
    const doc = (value) => ({ documentElement: { getAttribute: (name) => (name === PASSPORT_MARKER ? value : null) } });
    assert.strictEqual(passportInstalled(doc('2')), true);
    assert.strictEqual(passportInstalled(doc('')), false);
    assert.strictEqual(passportInstalled(doc('abcdefghijklmnopabcdefghijklmnop')), false);
    assert.strictEqual(passportInstalled(null), false);
  });

  it('tells an older Passport from none, and reads a Window through its document', function () {
    const doc = (value) => ({ documentElement: { getAttribute: (name) => (name === PASSPORT_MARKER ? value : null) } });
    assert.strictEqual(passportStatus(doc('2')), 'ready');
    assert.strictEqual(passportStatus(doc('')), 'outdated');
    assert.strictEqual(passportStatus(doc('abcdefghijklmnopabcdefghijklmnop')), 'outdated');
    assert.strictEqual(passportStatus(doc(null)), 'missing');
    assert.strictEqual(passportStatus(undefined), 'missing');
    assert.strictEqual(passportStatus({ document: doc('2') }), 'ready');
    assert.strictEqual(passportInstalled({ document: doc('2') }), true);
  });

  it('posts the challenge with a port and reads the answer from that port only', async function () {
    const win = fakeWindow((data, port) => {
      assert.strictEqual(data.type, 'PASSPORT_CHALLENGE');
      assert.strictEqual(data.challenge, 'fabric:abc');
      port.postMessage({ type: 'PASSPORT_ASSERTION', ok: true, assertion: 'fabric:signed' });
      port.close();
    });
    const result = await askPassport(win, { challenge: 'fabric:abc', expiresAt: Date.now() + 60000 }).promise;
    assert.deepStrictEqual(result, { ok: true, assertion: 'fabric:signed' });
    assert.strictEqual(win.posted[0].targetOrigin, ORIGIN);
    assert.strictEqual(win.posted[0].transfer.length, 1);
  });

  it('passes on a refusal and can be cancelled', async function () {
    const refused = fakeWindow((data, port) => { port.postMessage({ ok: false, error: 'declined' }); port.close(); });
    assert.deepStrictEqual(await askPassport(refused, { challenge: 'fabric:abc' }).promise, { ok: false, error: 'declined' });
    const silent = fakeWindow(null);
    const ask = askPassport(silent, { challenge: 'fabric:abc', expiresAt: Date.now() + 60000 });
    ask.cancel();
    assert.deepStrictEqual(await ask.promise, { ok: false, error: 'cancelled' });
  });

  it('runs challenge, Passport, and POST in order', async function () {
    const calls = [];
    const fetchImpl = async (url, init) => {
      const body = JSON.parse(init.body);
      calls.push({ url, body });
      if (url === '/sessions/challenges') {
        return { ok: true, status: 200, json: async () => ({ challenge: 'fabric:challenge', expiresAt: Date.now() + 60000 }) };
      }
      return { ok: true, status: 200, json: async () => ({ session: { identity: { id: 'id1' } } }) };
    };
    const win = fakeWindow((data, port) => {
      port.postMessage({ type: 'PASSPORT_ASSERTION', ok: true, assertion: `signed:${data.challenge}` });
      port.close();
    });
    const out = await signInWithPassport({ window: win, fetch: fetchImpl, request: ['wallet'] });
    assert.strictEqual(out.ok, true);
    assert.deepStrictEqual(out.session, { identity: { id: 'id1' } });
    assert.deepStrictEqual(calls[0].body.request, ['wallet']);
    assert.strictEqual(calls[1].url, '/sessions');
    assert.strictEqual(calls[1].body.assertion, 'signed:fabric:challenge');
  });
});
