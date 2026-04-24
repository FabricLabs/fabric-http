'use strict';

/**
 * Predicate for the local **sample** HTTP server (`scripts/sample-hub-http-server.js`), not for
 * production `FabricHTTPServer` types. Pair with {@link import('./constants') constants}
 * (`SAMPLE_HUB_HTTP_SERVER_NAME`).
 */
const { SAMPLE_HUB_HTTP_SERVER_NAME } = require('./constants');

/**
 * @param {object|null|undefined} optionsBody - JSON body of `OPTIONS /` from an `HTTPServer`.
 * @returns {boolean}
 */
function isSampleHubHttpServerOptions (optionsBody) {
  if (!optionsBody || typeof optionsBody !== 'object') return false;
  return String(optionsBody.name || '') === SAMPLE_HUB_HTTP_SERVER_NAME;
}

module.exports = {
  isSampleHubHttpServerOptions
};
