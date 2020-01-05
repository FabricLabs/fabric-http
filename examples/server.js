'use strict';

const Server = require('../types/server');
const server = new Server({
  verbose: true
});

server.define('Example', {
  components: {
    list: 'example-list',
    view: 'example-view'
  }
});

async function main () {
  await server.start();
}

main();
