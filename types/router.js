'use strict';

const Fabric = require('@fabric/core');
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

    this.commit();

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

  _addRoute (route, component) {
    this.routes[component] = {
      path: route,
      regex: pathToRegExp(route)
    };
    // this.router.use(route.path, this._handleRoutableRequest.bind(this));
    return this.routes[route.name];
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

  async _handleRoutableRequest (event) {
    return this.router.route(event);
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
