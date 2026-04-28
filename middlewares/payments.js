'use strict';

const { sendPaymentRequired402Response } = require('../functions/sendPaymentRequired402Response');

/**
 * @param {Record<string, unknown> | null | undefined} p `settings.payments` (or equivalent)
 * @returns {boolean} Whether payments are enabled in settings.
 */
function isPaymentsEnabled (p) {
  if (!p || typeof p !== 'object') return false;
  return p.enabled === true || p.enabled === 1 || p.enabled === '1';
}

/**
 * HTTP 402 Payment Required handler for routes that mount this middleware.
 * Must be bound to the HTTPServer instance (`payments.bind(server)`).
 *
 * When `invoice` resolves, sets **`X-Fabric-Payment-Request`** (value = **base64url( UTF-8 JSON )** with Fabric document-offer + invoice summary)
 * for browser extension auto-pay. Decode: `Buffer.from(header, 'base64url').toString('utf8')` → `JSON.parse`. Optional **`settings.payments.lightningL402`**: emit **`WWW-Authenticate: L402`**
 * when a BOLT11 string is present on the invoice.
 *
 * Enable with `settings.payments.enabled === true` and a Bitcoin-capable
 * `server` (`_registerBitcoin` / `this.bitcoin.createInvoice`).
 *
 * @param {import('http').IncomingMessage} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
function paymentsMiddleware (req, res, next) {
  const p = (this && this.settings && this.settings.payments) || {};
  if (!isPaymentsEnabled(p)) {
    return next();
  }

  Promise.resolve(sendPaymentRequired402Response(this, req, res, {}))
    .catch((error) => {
      console.error('[payments] sendPaymentRequired402Response:', error);
      if (!res.headersSent) {
        return res.status(500).json({
          type: 'https://fabric.pub/problems/invoice-error',
          title: 'Internal Server Error',
          status: 500,
          detail: 'Could not create an invoice.'
        });
      }
      return undefined;
    });
}

module.exports = paymentsMiddleware;
module.exports.isPaymentsEnabled = isPaymentsEnabled;
module.exports.sendPaymentRequired402Response = sendPaymentRequired402Response;
