'use strict';

const Fabric = require('@fabric/core');

class Router extends Fabric.Service {
  constructor (settings = {}) {
    super(settings);

    let fee = {
      '@type': 'BasisPointsOnValue',
      '@data': 20
    };

    this.current = null;
    this.settings = Object.assign({ fee }, settings);
    this.routes = {};
    this.commit();

    return this;
  }

  async _addFlat (path, definition) {
    this.routes[path] = definition;
  }

  async _deliver (target, msg) {
    console.log('delivering:', target, msg);
    return this.members[target];
  }

  async _route (path) {
    return this.route(path);
  }

  async route (msg) {
    this.current = msg;
    return this.routes[msg];
  }

  async start () {
    console.log('[FABRIC:HTTP]', 'ROUTER()', 'starting...');
    this.status = 'started';
    this.commit();
    console.log('[FABRIC:HTTP]', 'ROUTER()', 'started!', this.state);
    return this;
  }
}

module.exports = Router;
