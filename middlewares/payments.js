'use strict';

module.exports = function paymentsMiddleware (req, res, next) {
  console.debug('Payments middleware invoked:', req.method, req.path, req.id);
  let pathRequiresPayment = true;
  if (pathRequiresPayment) {
    this.bitcoin.createInvoice({ amount:  0.01, description: 'Test payment' }).then((invoice) => {
      this.invoices[invoice.id] = invoice;
      return res.status(402).json({
        message: 'Payment required',
        invoice: invoice
      });
    }).catch((error) => {
      console.error('Error creating invoice:', error);
      return res.status(500).json({ error: 'Internal server error' });
    });
  } else {
    // If the path does not require payment, proceed to the next middleware
    return next();
  }
}
