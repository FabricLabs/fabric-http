'use strict';

const assert = require('assert');
const net = require('net');
const HTTPServer = require('../types/server');
const { decodeFabricPaymentRequestHeaderValue } = require('../functions/fabricDocumentPayment402');
const { httpRequest } = require('./helpers/httpRequest');

function ephemeralPort () {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.listen(0, '127.0.0.1', () => {
      const addr = s.address();
      const port = typeof addr === 'object' && addr ? addr.port : null;
      s.close((err) => (err ? reject(err) : resolve(port)));
    });
    s.on('error', reject);
  });
}

describe('HTTPServer — payments (402) configuration', function () {
  this.timeout(60000);

  it('GET /services/test returns prize when payments are disabled (default)', async function () {
    const port = await ephemeralPort();
    const server = new HTTPServer({
      port,
      host: '127.0.0.1',
      interface: '127.0.0.1',
      hostname: '127.0.0.1',
      listen: true,
      payments: { enabled: false }
    });
    await server.start();
    try {
      const r = await httpRequest({ port, path: '/services/test' });
      assert.strictEqual(r.statusCode, 200);
      const j = JSON.parse(r.body);
      assert.strictEqual(j.message, 'I am the prize!');
    } finally {
      await server.stop().catch(() => {});
    }
  });

  it('GET /services/test still returns prize when payments enabled but not mounted on test route', async function () {
    const port = await ephemeralPort();
    const server = new HTTPServer({
      port,
      host: '127.0.0.1',
      interface: '127.0.0.1',
      hostname: '127.0.0.1',
      listen: true,
      payments: { enabled: true, exposePaymentTestRoute: false }
    });
    await server.start();
    try {
      const r = await httpRequest({ port, path: '/services/test' });
      assert.strictEqual(r.statusCode, 200);
      const j = JSON.parse(r.body);
      assert.strictEqual(j.message, 'I am the prize!');
    } finally {
      await server.stop().catch(() => {});
    }
  });

  it('with payments on test route and no bitcoin backend, returns 503', async function () {
    const port = await ephemeralPort();
    const server = new HTTPServer({
      port,
      host: '127.0.0.1',
      interface: '127.0.0.1',
      hostname: '127.0.0.1',
      listen: true,
      payments: { enabled: true, exposePaymentTestRoute: true }
    });
    await server.start();
    try {
      const r = await httpRequest({ port, path: '/services/test' });
      assert.strictEqual(r.statusCode, 503);
      const j = JSON.parse(r.body);
      assert.strictEqual(j.status, 503);
      assert.ok(String(j.type || '').includes('unavailable') || (j.title && /unavailable/i.test(j.title)));
    } finally {
      await server.stop().catch(() => {});
    }
  });

  it('402 with mocked bitcoin emits X-Fabric-Payment-Request (+ optional L402)', async function () {
    const port = await ephemeralPort();
    const server = new HTTPServer({
      port,
      host: '127.0.0.1',
      interface: '127.0.0.1',
      hostname: '127.0.0.1',
      listen: true,
      payments: {
        enabled: true,
        exposePaymentTestRoute: true,
        lightningL402: true,
        documentOffer: {
          documentId: 'fixture',
          purchasePriceSats: 42
        }
      }
    });
    server._registerBitcoin({
      createInvoice: () => Promise.resolve({
        id: 'inv-fixture',
        amount: 0.01,
        currency: 'BTC',
        payment_request: 'lnbc1500n1pfixture'
      })
    });
    await server.start();
    try {
      const r = await httpRequest({ port, path: '/services/test' });
      assert.strictEqual(r.statusCode, 402);
      const hdr = r.headers['x-fabric-payment-request'];
      assert.ok(typeof hdr === 'string' && hdr.length > 10, 'X-Fabric-Payment-Request present');
      const parsed = JSON.parse(decodeFabricPaymentRequestHeaderValue(hdr));
      assert.strictEqual(parsed.documentExchange.offerType, 'FABRIC_DOCUMENT_OFFER');
      assert.strictEqual(parsed.documentOffer.documentId, 'fixture');
      const auth = r.headers['www-authenticate'];
      assert.ok(typeof auth === 'string' && auth.startsWith('L402'), 'L402 WWW-Authenticate');
      assert.ok(auth.includes('lnbc1500n1pfixture'));
    } finally {
      await server.stop().catch(() => {});
    }
  });
});
