'use strict';

const assert = require('assert');
const { MessageChannel } = require('worker_threads');
const {
  PASSPORT_MARKER,
  probePassport,
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
  it('finds Passport by its answer to the hello, on a private port', async function () {
    const win = fakeWindow((data, port) => {
      assert.deepStrictEqual(data, { source: 'fabric-site', type: 'PASSPORT_HELLO', v: 2 });
      port.postMessage({ type: 'PASSPORT_HELLO', v: 2 });
      port.close();
    });
    assert.strictEqual(await probePassport(win), 'ready');
    assert.strictEqual(win.posted[0].targetOrigin, ORIGIN);
    assert.strictEqual(win.posted[0].transfer.length, 1);
  });

  it('tells an older Passport (marker, or another version) from none', async function () {
    const marked = (value) => Object.assign(fakeWindow(null), {
      document: { documentElement: { getAttribute: (name) => (name === PASSPORT_MARKER ? value : null) } }
    });
    assert.strictEqual(await probePassport(marked('2'), { timeoutMs: 20 }), 'outdated');
    assert.strictEqual(await probePassport(marked(''), { timeoutMs: 20 }), 'outdated');
    assert.strictEqual(await probePassport(marked(null), { timeoutMs: 20 }), 'missing');
    assert.strictEqual(await probePassport(fakeWindow(null), { timeoutMs: 20 }), 'missing');
    assert.strictEqual(await probePassport(undefined), 'missing');
    const old = fakeWindow((data, port) => { port.postMessage({ type: 'PASSPORT_HELLO', v: 1 }); port.close(); });
    assert.strictEqual(await probePassport(old), 'outdated');
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
