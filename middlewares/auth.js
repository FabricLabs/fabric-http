'use strict';

const {
  HTTP_IDENTITY_HEADER_NAME,
  HTTP_SIGNATURE_HEADER_NAME,
  HTTP_IDENTITY_HEADER_NAME_LOWER,
  HTTP_SIGNATURE_HEADER_NAME_LOWER
} = require('../constants');

const Identity = require('@fabric/core/types/identity');
// const Peer = require('@fabric/core/types/peer');

const hasRole = require('../contracts/hasRole');
// const hasState = require('./hasState');

module.exports = function FabricAuthenticationMiddleware (request, response, next) {
  request.identity = null;
  request.hasRole = hasRole.bind(request);
  // request.hasState = hasState.bind(app.state);

  if (request.headers[HTTP_IDENTITY_HEADER_NAME_LOWER]) {
    try {
      request.identity = Identity.fromString(request.headers[HTTP_IDENTITY_HEADER_NAME_LOWER]);
    } catch {

    }
  } else {
    this.emit('debug', `[WARNING] No "${HTTP_IDENTITY_HEADER_NAME}" header.  Consider rejecting here.`);
  }

  return next();
};
