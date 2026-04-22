'use strict';

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

  const v = (this && this.settings && this.settings.verbosity) || 0;
  if (v >= 5) {
    console.debug('[payments]', req.method, req.path, req.id);
  }

  if (!this.bitcoin || typeof this.bitcoin.createInvoice !== 'function') {
    return res.status(503).json({
      type: 'https://fabric.pub/problems/bitcoin-unavailable',
      title: 'Payment service unavailable',
      status: 503,
      detail: 'No invoice backend is configured on this server.'
    });
  }

  const defaultAmount = 0.01;
  const n = p.amount != null ? Number(p.amount) : defaultAmount;
  const amount = Number.isFinite(n) && n > 0 ? n : defaultAmount;
  const description = typeof p.description === 'string' && p.description.trim()
    ? p.description.trim()
    : 'Fabric access';
  const currency = typeof p.currency === 'string' && p.currency.trim() ? p.currency.trim() : 'BTC';

  this.bitcoin
    .createInvoice({ amount, description, currency })
    .then((invoice) => {
      if (!this.invoices) this.invoices = {};
      this.invoices[invoice.id] = invoice;
      return res
        .status(402)
        .set('Content-Type', 'application/json; charset=utf-8')
        .json({
          type: 'https://fabric.pub/problems/payment-required',
          title: 'Payment Required',
          status: 402,
          detail: p.detail || 'Complete payment to continue.',
          currency,
          amount,
          invoice
        });
    })
    .catch((error) => {
      console.error('[payments] createInvoice:', error);
      return res.status(500).json({
        type: 'https://fabric.pub/problems/invoice-error',
        title: 'Internal Server Error',
        status: 500,
        detail: 'Could not create an invoice.'
      });
    });
}

module.exports = paymentsMiddleware;
module.exports.isPaymentsEnabled = isPaymentsEnabled;
