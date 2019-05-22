'use strict';

const {
  HTTP_CLIENT_PORT,
  HTTPS_CLIENT_PORT
} = require('../constants');

const D3GraphViz = require('d3-graphviz');

// TODO: switch core to types
const Circuit = require('@fabric/core/lib/circuit');
const App = require('../types/app');

async function main () {
  window.App = App;
  window.app = new App();
  window.circuit = new Circuit();
  // window.graph = D3GraphViz.graphviz('#graph').renderDot(window.circuit.dot);
  // window.graph = D3GraphViz('#graph').renderDot(window.circuit.dot);

  window.app._verifyElements();

  console.log('[FABRIC:WEB]', 'ready!');
}

main();
