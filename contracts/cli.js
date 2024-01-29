'use strict';

// Settings
const playnet = require('../settings/playnet');
const local = require('../settings/local');

const settings = {
  authority: local.authority,
  listen: local.listen,
  // sideload playnet
  peers: [].concat(playnet.peers),
  port: process.env.FABRIC_PORT
    || local.port
    || playnet.port
    || 7777,
  services: local.services,
  key: {
    seed: playnet.seed
  }
};

// Fabric Types
const Contract = require('@fabric/core/types/contract');
const CLI = require('@fabric/core/types/cli');

// Services
const HTTPServer = require('../types/server');

// Program Definition
async function main (input = {}) {
  if (!(this instanceof Contract)) return new Contract(input);

  // Fabric CLI
  const cli = new CLI(settings); // TODO: this.settings

  if (!this.environment.wallet) {
    console.error('No wallet found!  Set up your Fabric wallet by running:');
    console.error('\tfabric setup');
    process.exit(1);
  }

  cli.attachWallet(this.environment.wallet);

  // ## Services
  cli._registerService('http', HTTPServer);

  await cli.start();

  return JSON.stringify({
    id: cli.id,
    wallet: this.environment.wallet.id
  });
}

// Module
module.exports = main;
