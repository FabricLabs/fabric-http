'use strict';

/**
 * Demo 402 handler for routes that explicitly mount this middleware.
 * Must be bound to the HTTPServer instance (e.g. `payments.bind(server)`).
 */
module.exports = function paymentsMiddleware (req, res, next) {
  console.debug('Payments middleware invoked:', req.method, req.path, req.id);
  if (!this.bitcoin || typeof this.bitcoin.createInvoice !== 'function') {
    return res.status(503).json({ error: 'Payment service unavailable' });
  }
  this.bitcoin.createInvoice({ amount: 0.01, description: 'Test payment' }).then((invoice) => {
    if (!this.invoices) this.invoices = {};
    this.invoices[invoice.id] = invoice;
    return res.status(402).json({
      message: 'Payment required',
      invoice: invoice
    });
  }).catch((error) => {
    console.error('Error creating invoice:', error);
    return res.status(500).json({ error: 'Internal server error' });
  });
};
