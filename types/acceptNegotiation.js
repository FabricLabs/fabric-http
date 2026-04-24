'use strict';

/**
 * True when the client’s first `Accept` type is `text/html` (browser navigation / refresh),
 * as opposed to star-slash-star or `application/json` (typical for XHR / fetch to JSON APIs on the same path).
 * @param {import('http').IncomingMessage} req
 * @returns {boolean}
 */
function acceptFirstHtmlNavigation (req) {
  const a = req.headers && req.headers.accept;
  if (typeof a !== 'string') return false;
  const first = a.split(',')[0].trim().toLowerCase().split(';')[0];
  return first === 'text/html';
}

module.exports = {
  acceptFirstHtmlNavigation
};
