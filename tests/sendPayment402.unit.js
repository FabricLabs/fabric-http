'use strict';

const assert = require('assert');
const { sendPaymentRequired402Response } = require('../functions/sendPaymentRequired402Response');
const { decodeFabricPaymentRequestHeaderValue } = require('../functions/fabricDocumentPayment402');

function createCapturingResponse () {
  return {
    headersSent: false,
    statusCode: 200,
    headers: {},
    body: null,
    status (n) {
      this.statusCode = n;
      return this;
    },
    set (k, v) {
      this.headers[String(k).toLowerCase()] = v;
      return this;
    },
    json (body) {
      this.body = body;
      return this;
    }
  };
}

describe('sendPaymentRequired402Response', function () {
  it('responds 402 JSON with mocked server', async function () {
    const res = {
      status (n) {
        assert.strictEqual(n, 402);
        return this;
      },
      set (k, v) {
        this.headers = this.headers || {};
        this.headers[String(k).toLowerCase()] = v;
        return this;
      },
      json (body) {
        assert.strictEqual(body.status, 402);
      }
    };
    const req = { path: '/x', url: '/x' };
    const serverLike = {
      settings: {
        verbosity: 0,
        payments: {
          enabled: true,
          lightningL402: false,
          detail: 't',
          documentOffer: { documentId: 'd1', purchasePriceSats: 1 }
        }
      },
      bitcoin: {
        createInvoice: async () => ({
          id: 'inv-1',
          amount: 0.01,
          currency: 'BTC',
          bolt11: 'lnbc1unit-test'
        })
      },
      invoices: {}
    };

    await sendPaymentRequired402Response(serverLike, /** @type {never} */ (req), /** @type {never} */ (res), {});
    assert.ok(res.headers['x-fabric-payment-request']);
    const hdr = decodeFabricPaymentRequestHeaderValue(res.headers['x-fabric-payment-request']);
    assert.ok(hdr);
    const parsed = JSON.parse(hdr);
    assert.strictEqual(parsed.documentOffer.documentId, 'd1');
  });

  it('returns 502 when createInvoice yields no id', async function () {
    let status = 0;
    const res = {
      status (n) {
        status = n;
        return this;
      },
      set () {
        return this;
      },
      json () {}
    };
    const req = { path: '/x', url: '/x' };
    const serverLike = {
      settings: { verbosity: 0, payments: { enabled: true } },
      bitcoin: {
        createInvoice: async () => ({ amount: 1 })
      },
      invoices: {}
    };
    await sendPaymentRequired402Response(serverLike, /** @type {never} */ (req), /** @type {never} */ (res), {});
    assert.strictEqual(status, 502);
  });

  it('does not write 503 when headers were already sent', async function () {
    const res = {
      headersSent: true,
      status () {
        throw new Error('status() should not be called when headers are already sent');
      },
      set () {
        return this;
      },
      json () {
        throw new Error('json() should not be called when headers are already sent');
      }
    };
    const req = { path: '/x', url: '/x' };
    await sendPaymentRequired402Response(
      null,
      /** @type {never} */ (req),
      /** @type {never} */ (res),
      {}
    );
  });

  it('emits L402 challenge when enabled and bolt11 is present', async function () {
    const req = { path: '/x', url: '/x' };
    const res = createCapturingResponse();
    const serverLike = {
      settings: {
        verbosity: 0,
        payments: {
          enabled: true,
          lightningL402: true
        }
      },
      bitcoin: {
        createInvoice: async () => ({
          id: 'inv-l402',
          amount: 0.01,
          currency: 'BTC',
          payment_request: 'lnbc1l402fixture'
        })
      },
      invoices: {}
    };

    await sendPaymentRequired402Response(serverLike, /** @type {never} */ (req), /** @type {never} */ (res), {});
    assert.strictEqual(res.statusCode, 402);
    assert.ok(typeof res.headers['www-authenticate'] === 'string');
    assert.ok(res.headers['www-authenticate'].startsWith('L402 '));
    assert.ok(res.headers['www-authenticate'].includes('invoice="lnbc1l402fixture"'));
  });

  it('includes macaroon in L402 challenge when configured', async function () {
    const req = { path: '/x', url: '/x' };
    const res = createCapturingResponse();
    const serverLike = {
      settings: {
        verbosity: 0,
        payments: {
          enabled: true,
          lightningL402: true,
          l402MacaroonBase64: 'YmFzZTY0LW1hY2Fyb29u'
        }
      },
      bitcoin: {
        createInvoice: async () => ({
          id: 'inv-l402-mac',
          amount: 0.01,
          currency: 'BTC',
          bolt11: 'lnbc1withmac'
        })
      },
      invoices: {}
    };

    await sendPaymentRequired402Response(serverLike, /** @type {never} */ (req), /** @type {never} */ (res), {});
    const auth = res.headers['www-authenticate'];
    assert.ok(auth.includes('macaroon="YmFzZTY0LW1hY2Fyb29u"'));
    assert.ok(auth.includes('invoice="lnbc1withmac"'));
  });

  it('does not emit L402 challenge when bolt11 is absent', async function () {
    const req = { path: '/x', url: '/x' };
    const res = createCapturingResponse();
    const serverLike = {
      settings: {
        verbosity: 0,
        payments: {
          enabled: true,
          lightningL402: true
        }
      },
      bitcoin: {
        createInvoice: async () => ({
          id: 'inv-no-bolt',
          amount: 0.01,
          currency: 'BTC'
        })
      },
      invoices: {}
    };

    await sendPaymentRequired402Response(serverLike, /** @type {never} */ (req), /** @type {never} */ (res), {});
    assert.strictEqual(res.statusCode, 402);
    assert.strictEqual(res.headers['www-authenticate'], undefined);
  });

  it('returns sanitized invoice fields in body and header payload', async function () {
    const req = { path: '/x', url: '/x' };
    const res = createCapturingResponse();
    const serverLike = {
      settings: {
        verbosity: 0,
        payments: {
          enabled: true,
          lightningL402: false
        }
      },
      bitcoin: {
        createInvoice: async () => ({
          id: 'inv-public',
          amount: 0.01,
          currency: 'BTC',
          payment_request: 'lnbc1public',
          memo: 'Visible memo',
          privateKey: 'do-not-leak'
        })
      },
      invoices: {}
    };

    await sendPaymentRequired402Response(serverLike, /** @type {never} */ (req), /** @type {never} */ (res), {});
    assert.strictEqual(res.statusCode, 402);
    assert.ok(res.body && res.body.invoice);
    assert.strictEqual(res.body.invoice.id, 'inv-public');
    assert.strictEqual(res.body.invoice.privateKey, undefined);
    const decoded = decodeFabricPaymentRequestHeaderValue(res.headers['x-fabric-payment-request']);
    assert.ok(decoded);
    const parsed = JSON.parse(decoded);
    assert.strictEqual(parsed.invoice.id, 'inv-public');
    assert.strictEqual(parsed.invoice.privateKey, undefined);
  });

  it('bounds pending invoice cache size for repeated 402 responses', async function () {
    let counter = 0;
    const serverLike = {
      settings: {
        verbosity: 0,
        payments: {
          enabled: true,
          lightningL402: false
        }
      },
      bitcoin: {
        createInvoice: async () => ({
          id: `inv-${counter++}`,
          amount: 0.01,
          currency: 'BTC',
          bolt11: `lnbc1-${counter}`
        })
      },
      invoices: {}
    };

    for (let i = 0; i < 530; i++) {
      const req = { path: '/x', url: '/x' };
      const res = createCapturingResponse();
      await sendPaymentRequired402Response(serverLike, /** @type {never} */ (req), /** @type {never} */ (res), {});
      assert.strictEqual(res.statusCode, 402);
    }

    assert.ok(Array.isArray(serverLike._invoiceOrder));
    assert.ok(serverLike._invoiceOrder.length <= 512, 'pending invoice order should be bounded to 512');
    assert.ok(Object.keys(serverLike.invoices).length <= 512, 'pending invoice map should be bounded to 512');
  });
});
