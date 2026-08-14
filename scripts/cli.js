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
const { readCliPasswordFromArgv } = require('@fabric/core/functions/cliPasswordArgv');
const { walletPathFromArgv } = require('../functions/cliWalletArgv');

// Contracts
const OP_BOOTSTRAP = require('../contracts/bootstrap.ts');
const OP_SERVE = require('../contracts/serve.ts');

const COMMANDS = {
  'BOOTSTRAP': OP_BOOTSTRAP,
  'SERVE': OP_SERVE
};

// Define Main Program
async function main (input = {}) {
  // Environment — read --wallet before Commander parse / start()
  const environment = new Environment({
    path: walletPathFromArgv(process.argv, process.wallet || file)
  });

  // Argument Parsing
  const program = new Command();

  // Unlock before serving so `--password=VALUE` matches `@fabric/core` `fabric`.
  environment.start();
  const passwordFromArgv = readCliPasswordFromArgv(process.argv);
  if (environment.walletLocked && passwordFromArgv) {
    try {
      environment.unlockWallet(passwordFromArgv);
    } catch (exception) {
      console.error('[FABRIC:HTTP]', 'Unlock failed:', exception.message || exception);
      process.exit(1);
      return;
    }
  }

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

if (require.main === module) {
  main(settings).catch((exception) => {
    console.error('[FABRIC:HTTP]', 'Main Process Exception:', exception);
  }).then((output) => {
    console.log('[FABRIC:HTTP]', 'CLI Output:', output);
  });
}
