'use strict';

const Fabric = require('@fabric/core');
const pluralize = require('pluralize');
const pathToRegExp = require('path-to-regexp');

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
    this.components = {};
    this.resources = {};
    this.routes = {};
    this.page = null;

    return this;
  }

  define (name, definition) {
    let result = super.define(name, definition);

    if (definition.components) {
      if (definition.components.list) {
        this.components[definition.components.list] = 'name/list';
      }
      if (definition.components.view) {
        this.components[definition.components.view] = 'name/view';
      }
    }

    return result;
  }

  route (msg) {
    console.log('[MAKI:ROUTER]', 'ROUTING THE FOLLOWING MESSAGE', msg, this.routes);
    let route = this._route(msg);
    console.log('THE ROUTE:', route);
    this.current = msg;
    return Object.assign({
      fee: this.settings.fee,
      route: route
    });
  }

  _addRoute (route, component) {
    this.routes[component] = {
      path: route,
      regex: pathToRegExp(route)
    };
    // this.router.use(route.path, this._handleRoutableRequest.bind(this));
    return this.routes[route.name];
  }

  _route (path) {
    for (let name in this.routes) {
      let route = this.routes[name];
      let match = route.regex.exec(path);
      if (match) {
        return {
          resource: route.resource,
          component: name
        };
      }
    }
    return null;
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

  async _handleRoutableRequest (event) {
    return this.router.route(event);
  }

  async start () {
    if (this.settings.verbosity >= 4) console.log('[FABRIC:HTTP]', 'ROUTER()', 'starting...');
    this.status = 'starting';

    try {
      await this.store.start();
    } catch (E) {
      console.error('Could not start router:', E);
    }

    for (let name in this.routes) {
      let route = new Fabric.Entity(this.routes[name].path);
      this.state.channels[route.id] = Object.assign({
        path: this.routes[name].path,
        members: [],
        messages: []
      });
    }

    this.status = 'started';

    if (this.settings.verbosity >= 4) console.log('[FABRIC:HTTP]', 'ROUTER()', 'started!', this.state);

    return this;
  }

  async stop () {
    if (this.settings.verbosity >= 4) console.log('[FABRIC:HTTP]', 'ROUTER()', 'Stopping...');

    this.status = 'stopping';

    try {
      await this.store.stop();
    } catch (E) {
      console.error('Could not stop router:', E);
    }

    this.status = 'stopped';

    return this;
  }
}

module.exports = Router;
