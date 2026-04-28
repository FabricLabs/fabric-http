'use strict';

const {
  FABRIC_PAYMENT_REQUEST_HEADER,
  buildFabricDocumentPaymentRequestHeader,
  encodeFabricPaymentRequestHeaderValue,
  buildLightningL402WwwAuthenticate,
  extractBolt11
} = require('./fabricDocumentPayment402');

/**
 * Emit HTTP 402 with `X-Fabric-Payment-Request` (and optional `WWW-Authenticate: L402`).
 * Call only when **`settings.payments.enabled`** and **`server.bitcoin.createInvoice`** exist —
 * callers that need the `{ enabled: false }` fast path must check first.
 *
 * @param {{ settings?: { payments?: Record<string, unknown>, verbosity?: number }, bitcoin?: { createInvoice: Function }, invoices?: Record<string, unknown> }} server HTTPServer-shaped instance (`this` from payments middleware).
 * @param {import('http').IncomingMessage} req
 * @param {import('express').Response} res
 * @param {{ paymentSettings?: Record<string, unknown> }} [options] Merged over `server.settings.payments` (e.g. per-document **`documentOffer`**, **`amount`**, **`detail`**).
 * @returns {Promise<void>}
 */
async function sendPaymentRequired402Response (server, req, res, options = {}) {
  const base = (server && server.settings && server.settings.payments) || {};
  const p = { ...base, ...(options.paymentSettings || {}) };

  const v = (server && server.settings && server.settings.verbosity) || 0;
  if (v >= 5) {
    console.debug('[payments:402]', req.method, req.path, req.id);
  }

  if (!server || !server.bitcoin || typeof server.bitcoin.createInvoice !== 'function') {
    res.status(503).json({
      type: 'https://fabric.pub/problems/bitcoin-unavailable',
      title: 'Payment service unavailable',
      status: 503,
      detail: 'No invoice backend is configured on this server.'
    });
    return;
  }

  const defaultAmount = 0.01;
  const n = p.amount != null ? Number(p.amount) : defaultAmount;
  const amount = Number.isFinite(n) && n > 0 ? n : defaultAmount;
  const description =
    typeof p.description === 'string' && p.description.trim()
      ? p.description.trim()
      : 'Fabric access';
  const currency = typeof p.currency === 'string' && p.currency.trim()
    ? p.currency.trim()
    : 'BTC';

  const documentOffer =
    p.documentOffer && typeof p.documentOffer === 'object' ? p.documentOffer : null;
  const l402Mac = typeof p.l402MacaroonBase64 === 'string' ? p.l402MacaroonBase64.trim() : '';
  const wantL402 = p.lightningL402 === true || p.lightningL402 === 1 || p.lightningL402 === '1';

  const invoice = await server.bitcoin.createInvoice({ amount, description, currency });

  if (!server.invoices) server.invoices = {};
  server.invoices[invoice.id] = invoice;

  const fabricJson = buildFabricDocumentPaymentRequestHeader({
    invoice,
    requestPath: (req.path != null ? req.path : req.url) || '',
    detail: p.detail || 'Complete payment to continue.',
    documentOffer
  });
  const fabricHeaderValue = encodeFabricPaymentRequestHeaderValue(fabricJson);

  /** @type {import('express').Response} */
  let r = res
    .status(402)
    .set('Content-Type', 'application/json; charset=utf-8')
    .set(FABRIC_PAYMENT_REQUEST_HEADER, fabricHeaderValue);

  if (wantL402) {
    const bolt11 = extractBolt11(invoice);
    const www = buildLightningL402WwwAuthenticate({
      bolt11,
      macaroonBase64: l402Mac || null
    });
    if (www) r = r.set('WWW-Authenticate', www);
  }

  r.json({
    type: 'https://fabric.pub/problems/payment-required',
    title: 'Payment Required',
    status: 402,
    detail: p.detail || 'Complete payment to continue.',
    currency,
    amount,
    invoice
  });
}

module.exports = {
  sendPaymentRequired402Response
};
