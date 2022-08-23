'use strict';

const Server = require('./server');
const Client = require('./client');
const SPA = require('./spa');

module.exports = {
  Server: Server,
  Client: Client,
  App: SPA,
  SPA: SPA,
  Site: SPA
};
