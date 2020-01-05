'use strict';

const Script = require('@fabric/core/types/script');
const App = require('../types/app');

async function showPrompt (state) {
  let confirmed = confirm('Confirming this dialog will execute the next portion of the contract.  Canceling will abort.');
  if (confirmed) {
    let commit = await this.commit();
    console.log('commit generated:', commit);
  } else {
    console.log('Transition not accepted.  Contract halted.');
  }
  return true;
}

async function queryForUsername (state) {
  let username = prompt('What shall be your name?');
  let commit = await this.commit();
  console.log('username selected:', username);
  return username;
}

async function main () {
  let script = new Script({
    history: [
      { type: 'dispatch', data: { name: 'showPrompt' } },
      { type: 'dispatch', data: { name: 'queryForUsername' } }
    ]
  });
  let app = new App({
    name: 'Example Serverless App',
    description: 'This example can be duplicated externally, '
  });

  app._registerMethod('showPrompt', showPrompt.bind(app));
  app._registerMethod('queryForUsername', queryForUsername.bind(app));

  await app.start();
  await app.dispatch('showPrompt');
  await app.dispatch('queryForUsername');

  console.log('output app:', app);
  console.log('output script:', script);
}

main();
