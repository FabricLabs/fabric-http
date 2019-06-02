'use strict';

const Fabric = require('@fabric/core');

/**
 * Simple router.
 * @type {Object}
 */
class Router extends Fabric.Service {
  /**
   * Builds a new {@link Router}.
   * @param  {Object} [settings={}] Configuration for the router.
   * @return {Router}               Instance of the {@link Router}.
   */
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

  /**
   * Add a named definition.
   * @param  {String}  path       Flat path.
   * @param  {Object}  definition Resource definition?
   * @return {Promise}            Resolves once added.
   */
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
    return Object.assign({
      fee: this.settings.fee,
      route: this.routes[msg]
    });
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
