'use strict';


const Server = require('../types/server');

async function main () {
  const server = new Server({
    verbosity: 5
  });

  await server.define('Example', {
    components: {
      list: 'example-list',
      view: 'example-view'
    }
  });

  await server.start();
}

main();
