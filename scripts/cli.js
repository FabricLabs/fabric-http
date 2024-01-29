#!/usr/bin/env node

// Constants
const {
  BITCOIN_GENESIS
} = require('@fabric/core/constants');

// Settings
const settings = require('../settings/local');

// Paths
const path = process.env.HOME + '/.fabric-http';
const file = path + '/wallet.json';

// Dependencies
const { Command } = require('commander');

// Fabric Types
const Environment = require('@fabric/core/types/environment');

// Contracts
const OP_BOOTSTRAP = require('../contracts/bootstrap.ts');
const OP_SERVE = require('../contracts/serve.ts');

const COMMANDS = {
  'BOOTSTRAP': OP_BOOTSTRAP,
  'SERVE': OP_SERVE
};

// Define Main Program
async function main (input = {}) {
  // Environment
  const environment = new Environment({
    path: process.wallet
  });

  // Argument Parsing
  const program = new Command();

  // Read Environment
  environment.start();

  // Configure Program
  program.name('fabric-http');

  // Declare Commands
  // FABRIC BOOTSTRAP
  // Configure the environment.
  program.command('bootstrap')
    .description('Ensures your environment configuration.')
    .action(COMMANDS['BOOTSTRAP'].bind({ environment, program }));

  // FABRIC START
  // Run the basic node.
  program.command('serve', { isDefault: true })
    .description('Serve local assets.')
    .action((x) => {
      return new Promise((resolve, reject) => {
        COMMANDS['SERVE'].apply({ environment, program, input }, [ input ]);
      });
    });

  // Options
  program.option('--assets <PATH>', 'Specify assets to serve.', 'assets');
  program.option('--interface <INTERFACE>', 'Specify the cleartext HTTP interface.', '0.0.0.0');
  program.option('--port <PORT NUMBER>', 'Specify the cleartext HTTP port.', 9999);
  program.option('--seed <SEED PHRASE>', 'Specify the BIP 39 seed phrase (12 or 24 words).');
  program.option('--passphrase <PASSPHRASE>', 'Specify the BIP 39 passphrase.', '');
  program.option('--password <PASSWORD>', 'Specify the encryption password.', '');
  program.option('--anchor <GENESIS>', 'Specify the anchor chain.', BITCOIN_GENESIS);
  program.option('--wallet <FILE>', 'Load wallet from file.', file);

  // Parse Arguments
  program.parse(process.argv);

  // TODO: read & test contracts
  // const contracts = environment.readContracts();

  return this;
}

// Run Program
main(settings).catch((exception) => {
  console.error('[FABRIC:HTTP]', 'Main Process Exception:', exception);
}).then((output) => {
  console.log('[FABRIC:HTTP]', 'CLI Output:', output);
});
