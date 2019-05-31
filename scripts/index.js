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

  // TODO: move these into App
  window.app.actions = [];
  window.app.bindings = [];

  let elements = document.querySelectorAll('*[data-bind]');
  console.log('found bound elements:', elements);
  for (let i = 0; i < elements.length; i++) {
    let element = elements[i];
    let binding = element.getAttribute('data-bind');
    console.log('found element with binding:', element, binding);
    window.app.bindings.push(element);
    window.circuit.on(binding, function (data) {
      console.log('received replacement data (from circuit!) targeted for binding:', binding);
      element.innerHTML = data;
    });

    window.app.on(binding, function (data) {
      console.log('received replacement data targeted for binding:', binding);
      element.innerHTML = data;
    });
  }

  let actionables = document.querySelectorAll('*[data-action]');
  console.log('found actionable elements:', actionables);
  for (let i = 0; i < actionables.length; i++) {
    let element = actionables[i];
    let action = element.getAttribute('data-action');
    console.log('found element with action:', element, action);
    element.addEventListener('click', function (event) {
      console.log('click event on actionable element:', action, event);
      let result = window.circuit[action].call(window.circuit);
      console.log('result:', result);
    });
    window.app.actions.push(element);
  }

  console.log('[FABRIC:WEB]', 'ready!!!');
}

main();
