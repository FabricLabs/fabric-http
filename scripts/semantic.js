#!/usr/bin/env node
'use strict';

// fabric-http-semantic: put the Fabric Semantic UI assets into ./assets — compiled with the
// overrides in ./semantic/site when there are any, otherwise copied from @fabric/http.
const { run } = require('../functions/semanticBuild');

run({ root: process.cwd() }).catch((error) => {
  console.error('[fabric-http] Semantic build failed:', error && error.message ? error.message : error);
  process.exit(1);
});
