'use strict';

const SPA = require('../types/spa');
const Compiler = require('../types/compiler');

async function main () {
  const spa = new SPA();
  const compiler = new Compiler({
    document: spa
  });

  compiler.compileTo('assets/index.html');

  // TODO: why isn't SPA exiting?
  // process.exit();
}

main();
