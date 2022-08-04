'use strict';

const {
  HTTP_CLIENT_PORT,
  HTTPS_CLIENT_PORT
} = require('../constants');

const D3GraphViz = require('d3-graphviz');

// TODO: switch core to types
const Service = require('@fabric/core/types/service');
const Circuit = require('@fabric/core/types/circuit');
const App = require('../types/app');

async function main () {
  window.App = App;
  window.Circuit = Circuit;
  window.Service = Service;
  window.D3GraphViz = D3GraphViz;

  window.app = new App({
    resources: {
      // 'Depositor': Service
    }
  });

  window.app.service = new Service();
  window.app.circuit = new Circuit({
    gates: [],
    wires: [
      { name: 'ready', from: 'init', to: 'ready' },
      { name: 'step1', from: 'ready', to: '1' },
      { name: 'step2', from: '1', to: '2' },
      { name: 'step3', from: '2', to: '3' },
      { name: 'done', from: '3', to: 'complete' }
    ]
  });

  window.graph = D3GraphViz.graphviz('#svg', {
    fit: true,
    width: 800,
    height: 600
  }).renderDot(window.app.circuit.dot);

  // TODO: fix verification
  window.app._verifyElements();

  // TODO: move these into App
  window.app.actions = [];
  window.app.bindings = [];

  window.app.circuit.on('/', async function (msg) {
    console.log('[FABRIC:WEB]', 'Circuit emitted:', msg, msg['@data']);
    switch (msg['@type']) {
      default:
        console.error('unhandled circuit message type:', msg['@type']);
        break;
      case 'KeyUp':
        console.log('KeyUp:', msg['@data']);
        break;
      case 'Snapshot':
        console.log('Received snapshot:', msg['@data']);
        break;
    }
  });

  window.app.service.on('/', async function (msg) {
    console.log('[FABRIC:WEB]', 'Service emitted:', msg, msg['@data']);
    switch (msg['@type']) {
      default:
        console.error('unhandled service message type:', msg['@type']);
        break;
      case 'KeyUp':
        console.log('KeyUp:', msg['@data']);
        break;
      case 'Snapshot':
        console.log('Received snapshot:', msg['@data']);
        break;
    }
  });

  let elements = document.querySelectorAll('*[data-bind]');
  for (let i = 0; i < elements.length; i++) {
    let element = elements[i];
    let binding = element.getAttribute('data-bind');

    console.log('binding the element:', binding, element);

    element.addEventListener('keyup', async function (event) {
      if (!event.target) return false;
      if (!event.target.value) return false;
      await window.app.service._PUT('/source', event.target.value);
    });

    window.app.circuit.on(binding, function (data) {
      console.log('received replacement data (from circuit!) targeted for binding:', binding);
      element.innerHTML = data;
    });

    window.app.service.on(binding, function (data) {
      console.log('received replacement data (from service!) targeted for binding:', binding);
      element.innerHTML = data;
    });

    window.app.on(binding, function (data) {
      console.log('received replacement data targeted for binding:', binding);
      element.innerHTML = data;
    });

    window.app.bindings.push(element);
  }

  let actionables = document.querySelectorAll('*[data-action]');
  for (let i = 0; i < actionables.length; i++) {
    let element = actionables[i];
    let action = element.getAttribute('data-action');
    element.addEventListener('click', async function (event) {
      console.log('click event on actionable element:', action, event);
      let method = window.app.circuit.methods[action];
      if (!method) console.warn('NO METHOD ON CIRCUIT:', method);
      let result = await window.app.circuit[action].call(window.app.circuit);
      console.log('result:', result);
    });
    window.app.actions.push(element);
  }

  console.log('[FABRIC:WEB]', 'ready!!!');
}

main();
