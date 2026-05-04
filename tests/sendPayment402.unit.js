'use strict';

const assert = require('assert');
const { sendPaymentRequired402Response } = require('../functions/sendPaymentRequired402Response');
const { decodeFabricPaymentRequestHeaderValue } = require('../functions/fabricDocumentPayment402');

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
});
