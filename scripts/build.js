'use strict';

// Settings
const settings = require('../settings/local');

// Types
const Site = require('../types/site');
const Compiler = require('../types/compiler');

// Program Body
async function main (input = {}) {
  const site = new Site(input);
  const compiler = new Compiler({
    document: site
  });

  await compiler.compileTo('assets/site.html');

  return {
    site: site.id
  };
}

// Run Program
main(settings).catch((exception) => {
  console.error('[BUILD:SITE]', '[EXCEPTION]', exception);
}).then((output) => {
  console.log('[BUILD:SITE]', '[OUTPUT]', output);
});
