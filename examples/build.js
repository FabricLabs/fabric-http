'use strict';

const SPA = require('../types/spa');
const Compiler = require('../types/compiler');

async function main () {
  let spa = new SPA();
  let compiler = new Compiler({
    document: spa
  });

  console.log('compiler:', compiler);

  compiler.compileTo('assets/spa.html');
  // TODO: why isn't SPA exiting?
  process.exit();
}

main();
