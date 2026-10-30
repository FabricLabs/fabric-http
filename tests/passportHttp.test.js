'use strict';

const assert = require('assert');
const http = require('http');
const { FIXTURE_SEED } = require('@fabric/core/constants');
const { importSeed, deriveAccount } = require('@fabric/core/functions/accountKeys');
const { signAssertion } = require('@fabric/core/functions/passport');
const { createPassportRelyingParty } = require('../functions/passportRelyingParty');
const { createPassportHttp, passportOutdated, SESSION_COOKIE, BINDING_COOKIE } = require('../functions/passportHttp');

const SITE = 'https://site.example';
const OTHER_SITE = 'https://other.example';
const ACCOUNT = deriveAccount(importSeed(FIXTURE_SEED), { account: 0, network: 'regtest' });
const HOST_ACCOUNT = deriveAccount(importSeed(FIXTURE_SEED), { account: 3, network: 'regtest' });

function sign (challenge, origin, key = ACCOUNT.identity.key, signer = 'passport') {
  return signAssertion({ challenge, origin, signer, network: 'regtest' }, key).uri;
}

/** The same frame under another opcode, unsigned (e.g. v1 `SITE_LOGIN_RESPONSE` 0x4231). */
function retype (uri, opcode) {
  const frame = Buffer.from(uri.slice('fabric:'.length), 'base64url');
  frame.writeUInt32BE(opcode, 72);
  frame.fill(0, 40, 72);
  frame.fill(0, 144, 208);
  return `fabric:${frame.toString('base64url')}`;
}

/** Bare `http` server over the route table (no Express). */
function serve (passportHttp) {
  const server = http.createServer((req, res) => {
    const path = req.url.split('?')[0];
    const route = passportHttp.routes.find((r) => r.method === req.method && r.path === path);
    if (!route) {
      res.statusCode = 404;
      return res.end('{}');
    }
    return route.handler(req, res);
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

function request (server, method, path, { headers = {}, body } = {}) {
  const payload = body == null ? null : (typeof body === 'string' ? body : JSON.stringify(body));
  return new Promise((resolve, reject) => {
    const req = http.request({
      host: '127.0.0.1',
      port: server.address().port,
      method,
      path,
      headers: Object.assign(payload ? { 'content-type': 'application/json' } : {}, headers)
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let json = null;
        try { json = JSON.parse(text); } catch (_) {}
        resolve({ status: res.statusCode, headers: res.headers, body: json });
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

function cookieValue (res, name) {
  const list = res.headers['set-cookie'] || [];
  for (const line of list) {
    const [pair] = line.split(';');
    const at = pair.indexOf('=');
    if (pair.slice(0, at) === name) return { value: decodeURIComponent(pair.slice(at + 1)), line };
  }
  return null;
}

describe('passportHttp', function () {
  let server;
  let selfOrigin;

  async function start (settings = {}) {
    const rp = createPassportRelyingParty(Object.assign({
      pinnedOrigins: [SITE, OTHER_SITE],
      network: 'regtest',
      production: false
    }, settings.rp || {}));
    const routes = createPassportHttp(Object.assign({ relyingParty: rp }, settings.http || {}));
    server = await serve(routes);
    return { rp, routes };
  }

  afterEach(function (done) {
    if (!server) return done();
    server.close(() => done());
    server = null;
  });

  async function browserChallenge (origin = SITE, body = {}) {
    const res = await request(server, 'POST', '/sessions/challenges', { headers: { origin }, body });
    assert.strictEqual(res.status, 200, JSON.stringify(res.body));
    const binding = cookieValue(res, BINDING_COOKIE);
    assert.ok(binding, 'binding cookie set');
    return { res, binding: binding.value, line: binding.line };
  }

  it('signs a browser in with HttpOnly cookies and never returns a token', async function () {
    await start();
    const { res, binding, line } = await browserChallenge();
    assert.strictEqual(res.body.binding, undefined);
    assert.match(line, /HttpOnly/);
    assert.match(line, /SameSite=Strict/);
    assert.match(line, /Path=\/sessions/);
    assert.match(line, /Secure/);
    assert.strictEqual(res.body.origin, SITE);

    const signedIn = await request(server, 'POST', '/sessions', {
      headers: { origin: SITE, cookie: `${BINDING_COOKIE}=${binding}` },
      body: { assertion: sign(res.body.challenge, SITE) }
    });
    assert.strictEqual(signedIn.status, 200, JSON.stringify(signedIn.body));
    assert.strictEqual(signedIn.body.token, undefined);
    assert.strictEqual(signedIn.body.session.identity.pubkey, ACCOUNT.identity.pubkey);
    const session = cookieValue(signedIn, SESSION_COOKIE);
    assert.match(session.line, /HttpOnly/);
    assert.match(session.line, /SameSite=Strict/);

    const current = await request(server, 'GET', '/sessions/current', {
      headers: { cookie: `${SESSION_COOKIE}=${session.value}` }
    });
    assert.strictEqual(current.status, 200);
    assert.strictEqual(current.body.session.identity.id, ACCOUNT.identity.id);

    const ended = await request(server, 'DELETE', '/sessions/current', {
      headers: { origin: SITE, cookie: `${SESSION_COOKIE}=${session.value}` }
    });
    assert.strictEqual(ended.status, 200);
    const after = await request(server, 'GET', '/sessions/current', {
      headers: { cookie: `${SESSION_COOKIE}=${session.value}` }
    });
    assert.strictEqual(after.status, 401);
  });

  it('refuses a stolen assertion without the binding cookie', async function () {
    await start();
    const victim = await browserChallenge();
    const assertion = sign(victim.res.body.challenge, SITE);
    const attacker = await browserChallenge();
    const noCookie = await request(server, 'POST', '/sessions', { headers: { origin: SITE }, body: { assertion } });
    assert.strictEqual(noCookie.status, 400);
    const wrongCookie = await request(server, 'POST', '/sessions', {
      headers: { origin: SITE, cookie: `${BINDING_COOKIE}=${attacker.binding}` },
      body: { assertion }
    });
    assert.strictEqual(wrongCookie.status, 400);
    const late = await request(server, 'POST', '/sessions', {
      headers: { origin: SITE, cookie: `${BINDING_COOKIE}=${victim.binding}` },
      body: { assertion }
    });
    assert.strictEqual(late.status, 200, 'the victim still signs in');
  });

  it('tells a v1 client to update Passport', async function () {
    await start();
    const { res, binding } = await browserChallenge();
    const headers = { origin: SITE, cookie: `${BINDING_COOKIE}=${binding}` };
    for (const body of [{}, { origin: SITE }, { fabric: retype(res.body.challenge, 0x4231) }, { assertion: res.body.challenge }]) {
      const out = await request(server, 'POST', '/sessions', { headers, body });
      assert.strictEqual(out.status, 426, JSON.stringify(body));
      assert.strictEqual(out.body.error, 'passport_outdated');
      assert.match(out.body.message, /Update Fabric Passport/);
    }
    const signedIn = await request(server, 'POST', '/sessions', { headers, body: { assertion: sign(res.body.challenge, SITE) } });
    assert.strictEqual(signedIn.status, 200, 'the challenge survives v1 attempts');
    const fresh = await browserChallenge();
    const garbled = await request(server, 'POST', '/sessions', {
      headers: { origin: SITE, cookie: `${BINDING_COOKIE}=${fresh.binding}` },
      body: { assertion: 'fabric:AAAA' }
    });
    assert.strictEqual(garbled.status, 400, 'a malformed frame is not "outdated"');
  });

  it('passportOutdated reads v1 frames, other types, and missing input as outdated', async function () {
    await start();
    const { res } = await browserChallenge();
    const assertion = sign(res.body.challenge, SITE);
    assert.strictEqual(passportOutdated(assertion, 'PASSPORT_ASSERTION'), false);
    assert.strictEqual(passportOutdated(assertion, 'DELEGATION_REQUEST'), true);
    assert.strictEqual(passportOutdated(retype(assertion, 0x4232), 'DELEGATION_REQUEST'), true);
    assert.strictEqual(passportOutdated(undefined, 'PASSPORT_ASSERTION'), true);
    assert.strictEqual(passportOutdated('fabric:AAAA', 'PASSPORT_ASSERTION'), false);
  });

  it('lets one of two concurrent redeems through', async function () {
    await start();
    const { res, binding } = await browserChallenge();
    const assertion = sign(res.body.challenge, SITE);
    const send = () => request(server, 'POST', '/sessions', {
      headers: { origin: SITE, cookie: `${BINDING_COOKIE}=${binding}` },
      body: { assertion }
    });
    const results = await Promise.all([send(), send(), send()]);
    assert.strictEqual(results.filter((r) => r.status === 200).length, 1);
  });

  it('refuses unpinned origins and never reads the Host header', async function () {
    await start();
    const evil = await request(server, 'POST', '/sessions/challenges', { headers: { origin: 'https://evil.example' }, body: {} });
    assert.strictEqual(evil.status, 403);
    const spoofed = await request(server, 'POST', '/sessions/challenges', {
      headers: { host: 'site.example', 'x-fabric-native': '1' },
      body: {}
    });
    assert.strictEqual(spoofed.status, 403, 'two pinned origins and no Origin: nothing to issue for');
  });

  it('refuses a redeem from another origin than the challenge', async function () {
    await start();
    const { res, binding } = await browserChallenge(SITE);
    const cross = await request(server, 'POST', '/sessions', {
      headers: { origin: OTHER_SITE, cookie: `${BINDING_COOKIE}=${binding}` },
      body: { assertion: sign(res.body.challenge, SITE) }
    });
    assert.strictEqual(cross.status, 403);
  });

  it('gives a native client its binding and token in the body', async function () {
    await start({ rp: { pinnedOrigins: [SITE] } });
    const challenge = await request(server, 'POST', '/sessions/challenges', { headers: { 'x-fabric-native': '1' }, body: {} });
    assert.strictEqual(challenge.status, 200);
    assert.ok(/^[0-9a-f]{64}$/.test(challenge.body.binding));
    assert.strictEqual(cookieValue(challenge, BINDING_COOKIE), null);
    const signedIn = await request(server, 'POST', '/sessions', {
      headers: { 'x-fabric-native': '1', 'x-fabric-binding': challenge.body.binding },
      body: { assertion: sign(challenge.body.challenge, SITE) }
    });
    assert.strictEqual(signedIn.status, 200, JSON.stringify(signedIn.body));
    assert.ok(/^[0-9a-f]{64}$/.test(signedIn.body.token));
    assert.strictEqual(cookieValue(signedIn, SESSION_COOKIE), null);
    const current = await request(server, 'GET', '/sessions/current', {
      headers: { authorization: `Bearer ${signedIn.body.token}` }
    });
    assert.strictEqual(current.status, 200);
  });

  it('never returns a native token to a browser', async function () {
    await start();
    const challenge = await request(server, 'POST', '/sessions/challenges', {
      headers: { origin: SITE, 'x-fabric-native': '1' },
      body: {}
    });
    assert.strictEqual(challenge.status, 200);
    assert.strictEqual(challenge.body.binding, undefined);
    const binding = cookieValue(challenge, BINDING_COOKIE).value;
    const signedIn = await request(server, 'POST', '/sessions', {
      headers: { origin: SITE, 'x-fabric-native': '1', cookie: `${BINDING_COOKIE}=${binding}` },
      body: { assertion: sign(challenge.body.challenge, SITE) }
    });
    assert.strictEqual(signedIn.status, 200);
    assert.strictEqual(signedIn.body.token, undefined);
    assert.ok(cookieValue(signedIn, SESSION_COOKIE));
    const headerOnly = await request(server, 'POST', '/sessions', {
      headers: { origin: SITE, 'x-fabric-native': '1', 'x-fabric-binding': binding },
      body: { assertion: sign(challenge.body.challenge, SITE) }
    });
    assert.strictEqual(headerOnly.status, 400, 'a browser binding never comes from a header');
  });

  it('runs a session hook that can refuse or annotate', async function () {
    await start({
      http: {
        onSession: async (verified) => {
          if (verified.signer !== 'passport') {
            const err = new Error('passport only');
            err.status = 403;
            throw err;
          }
          return { member: 'abc' };
        }
      }
    });
    const ok = await browserChallenge();
    const signedIn = await request(server, 'POST', '/sessions', {
      headers: { origin: SITE, cookie: `${BINDING_COOKIE}=${ok.binding}` },
      body: { assertion: sign(ok.res.body.challenge, SITE) }
    });
    assert.strictEqual(signedIn.status, 200);
    const refused = await browserChallenge();
    const hub = await request(server, 'POST', '/sessions', {
      headers: { origin: SITE, cookie: `${BINDING_COOKIE}=${refused.binding}` },
      body: { assertion: sign(refused.res.body.challenge, SITE, ACCOUNT.identity.key, 'hub') }
    });
    assert.strictEqual(hub.status, 403);
    assert.strictEqual(cookieValue(hub, SESSION_COOKIE), null);
  });

  describe('POST /sessions/self', function () {
    async function startSelf () {
      const routes = await start({
        rp: { pinnedOrigins: [] },
        http: {
          selfOrigins: ['http://127.0.0.1:8080'],
          selfSign: async ({ challenge, origin }) => sign(challenge, origin, HOST_ACCOUNT.identity.key, 'hub')
        }
      });
      selfOrigin = 'http://127.0.0.1:8080';
      return routes;
    }

    it('signs the host page in as the host identity', async function () {
      await startSelf();
      const res = await request(server, 'POST', '/sessions/self', { headers: { origin: selfOrigin }, body: {} });
      assert.strictEqual(res.status, 200, JSON.stringify(res.body));
      assert.strictEqual(res.body.session.identity.pubkey, HOST_ACCOUNT.identity.pubkey);
      assert.strictEqual(res.body.session.signer, 'hub');
      assert.ok(cookieValue(res, SESSION_COOKIE));
    });

    it('refuses proxied requests, other origins, and no origin', async function () {
      await startSelf();
      const proxied = await request(server, 'POST', '/sessions/self', {
        headers: { origin: selfOrigin, 'x-forwarded-for': '203.0.113.9' },
        body: {}
      });
      assert.strictEqual(proxied.status, 403);
      const other = await request(server, 'POST', '/sessions/self', { headers: { origin: 'http://127.0.0.1:9999' }, body: {} });
      assert.strictEqual(other.status, 403);
      const none = await request(server, 'POST', '/sessions/self', { body: {} });
      assert.strictEqual(none.status, 403);
    });

    it('is absent without selfSign', async function () {
      await start();
      const res = await request(server, 'POST', '/sessions/self', { headers: { origin: SITE }, body: {} });
      assert.strictEqual(res.status, 404);
    });
  });
});
