'use strict';

const Oracle = require('@fabric/core/types/oracle');
const FabricHTTPServer = require('./server');
const ApplicationService = require('../services/application');

/**
 * Edge node composed of the one HTTP server.
 *
 * The HTTP listener, WebSocket, and JSON-RPC methods are {@link FabricHTTPServer}.
 * The application contract (sessions, peers, entities) is
 * {@link ApplicationService}, mounted with `define()` before listen.
 * This class does not build an Express app of its own.
 */
class Hub extends Oracle {
  /**
   * @param {Object} [configuration] Passed to {@link FabricHTTPServer}, minus `resources` (those are the application service).
   */
  constructor (configuration = {}) {
    super(configuration);

    const httpSettings = Object.assign({}, configuration);
    // Oracle uses `resources` for its own Actors/Keys set. The HTTP server
    // would try to `define()` that map. The application service owns the
    // contract resources instead.
    delete httpSettings.resources;

    this.http = new FabricHTTPServer(httpSettings);
    this.application = new ApplicationService();

    return this;
  }

  /**
   * Add another resource to the same server, on the application contract.
   * @param {String} name
   * @param {Object} [definition]
   * @returns {Promise<FabricHTTPServer>}
   */
  define (name, definition) {
    return this.http.define(name, definition);
  }

  /**
   * Bind the application contract and listen.
   * @returns {Promise<Hub>}
   */
  async start () {
    if (!this.application.bound) await this.application.bind(this.http);
    await this.http.start();
    return this;
  }

  /**
   * Stop the HTTP server.
   * @returns {Promise<Hub>}
   */
  async stop () {
    if (this.http && typeof this.http.stop === 'function') await this.http.stop();
    return this;
  }
}

module.exports = Hub;
