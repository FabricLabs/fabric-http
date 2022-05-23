'use strict';

const SPA = require('../types/spa');
const Compiler = require('../types/compiler');

async function main () {
  const spa = new SPA();
  const compiler = new Compiler({
    document: spa
  });

  console.log('compiler:', compiler);

  compiler.compileTo('assets/index.html');
  compiler.compileTo('assets/spa.html');

  // TODO: why isn't SPA exiting?
  process.exit();
}

main();
