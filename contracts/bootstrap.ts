'use strict';

const defaults = require('../package.json');

// TODO: deal with IO Monad
const fs = require('fs');

module.exports = async function OP_BOOTSTRAP () {
  // Constants
  const now = new Date();
  const commitment = 'state.json';
  const target = process.argv[1] || '.weave';
  const store = target + `/${commitment}`;
  const state = {
    bootstrap: store, 
    package: defaults,
    object: x
  };

  // Create target if it does not yet exist
  if (!fs.existsSync(target)) fs.mkdirSync(target);
  if (!fs.existsSync(store)) fs.utimesSync(target, now, now);

  // Canonical JSON String
  const json = JSON.stringify(state, null, '  ');

  // Write File
  fs.writeFileSync(store, Buffer.from(json, 'utf8'));

  // Canonical Object
  return {
    path: target,
    state: state
  };
};
