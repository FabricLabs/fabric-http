'use strict';

const assert = require('assert');
const {
  buildFabricDocumentPaymentRequestHeader,
  encodeFabricPaymentRequestHeaderValue,
  decodeFabricPaymentRequestHeaderValue,
  normalizePurchasePriceSats,
  buildLightningL402WwwAuthenticate,
  extractBolt11
} = require('../functions/fabricDocumentPayment402');

describe('fabricDocumentPayment402', function () {
  it('builds Fabric payment header linking document-offer envelope types', function () {
    const s = buildFabricDocumentPaymentRequestHeader({
      invoice: { id: 'a', bolt11: 'lnbc100n1ptest', currency: 'BTC' },
      requestPath: '/paid/doc',
      documentOffer: {
        documentId: 'readme',
        purchasePriceSats: 900,
        network: 'bitcoin'
      },
      detail: 'Pay to continue.'
    });
    const j = JSON.parse(s);
    assert.strictEqual(j.v, 1);
    assert.strictEqual(j.headerTransport, 'base64url.v1+json-utf8');
    assert.strictEqual(j.documentExchange.offerType, 'FABRIC_DOCUMENT_OFFER');
    assert.strictEqual(j.documentExchange.responseType, 'FABRIC_DOCUMENT_OFFER_RESPONSE');
    assert.strictEqual(j.documentExchange.inventoryWireOpcodes.request, 'P2P_INVENTORY_REQUEST');
    assert.strictEqual(j.documentOffer.documentId, 'readme');
    assert.strictEqual(j.documentOffer.purchasePriceSats, 900);
    assert.ok(j.invoice && j.invoice.bolt11);

    const enc = encodeFabricPaymentRequestHeaderValue(s);
    const decoded = decodeFabricPaymentRequestHeaderValue(enc);
    assert.ok(decoded);
    const round = JSON.parse(decoded);
    assert.strictEqual(round.documentOffer.documentId, 'readme');
  });

  it('decodeFabricPaymentRequestHeaderValue returns null for malformed input', function () {
    assert.strictEqual(decodeFabricPaymentRequestHeaderValue('%%%'), null);
    assert.strictEqual(decodeFabricPaymentRequestHeaderValue(null), null);
  });

  it('normalizePurchasePriceSats rejects negatives and unsafe integers', function () {
    assert.strictEqual(normalizePurchasePriceSats(-1), null);
    assert.strictEqual(normalizePurchasePriceSats(Number.MAX_SAFE_INTEGER + 42), null);
    assert.strictEqual(normalizePurchasePriceSats(900), 900);
  });

  it('buildFabricDocumentPaymentRequestHeader omits invalid purchasePriceSats', function () {
    const s = buildFabricDocumentPaymentRequestHeader({
      documentOffer: { documentId: 'x', purchasePriceSats: -5 }
    });
    const j = JSON.parse(s);
    assert.strictEqual(j.documentOffer.documentId, 'x');
    assert.strictEqual(j.documentOffer.purchasePriceSats, undefined);
  });

  it('extractBolt11 prefers payment_request alias', function () {
    assert.strictEqual(
      extractBolt11({ payment_request: 'lnbc999' }),
      'lnbc999'
    );
  });

  it('buildLightningL402WwwAuthenticate returns empty without bolt11', function () {
    assert.strictEqual(buildLightningL402WwwAuthenticate({ bolt11: '' }), '');
  });

  it('buildLightningL402WwwAuthenticate includes macaroon when provided', function () {
    const h = buildLightningL402WwwAuthenticate({
      bolt11: 'lnbc1test',
      macaroonBase64: 'YmFzZTY0Cg=='
    });
    assert.ok(/^L402 /.test(h));
    assert.ok(h.includes('macaroon='));
    assert.ok(h.includes('invoice='));
    assert.ok(h.includes('lnbc1test'));
  });
});
