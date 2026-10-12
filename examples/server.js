'use strict';

const settings = require('../settings/default');
const Server = require('../types/server');
require('../components/resource-list');
require('../components/resource-view');

async function main () {
  const server = new Server(settings);

  await server.define('Example', {
    components: {
      list: 'fabric-resource-list',
      view: 'fabric-resource-view'
    }
  });

  await server.start();
}

main();
