'use strict';

/**
 * HTTP adapter for an edge node's Application Resource Contract.
 *
 * `types/hub.js` used to be a second Express server with its own routes.
 * Those routes are the application's resources, and this service mounts them
 * on the one {@link FabricHTTPServer} through `define()`. That is the same
 * translation the rest of the suite uses: a resource in the contract is a
 * collection on the edge, and HTTP is the verb table for that collection.
 *
 * Fabric side, carried on `OPTIONS /` (`functions/applicationResourceContract`):
 * - The contract document is an Application Resource Contract.
 * - Its id is the Actor id of the definition, the same id a `CONTRACT_PUBLISH`
 *   genesis uses for the namespace.
 * - `resources` lists each collection, its paths, and its description.
 * - A create is the collection `Create` message. The server emits that as an
 *   Entity `{ '@type': <resource name>, '@data' }`.
 *
 * HTTP side, on each resource (`types/resource.js`):
 * - `GET` / `HEAD` list and item, `POST` create (303), `PUT` replace,
 *   `PATCH` merge, `DELETE` 204, `SEARCH` filter, `OPTIONS` schema.
 *
 * These paths are the application contract. They are not the other mounts:
 * - Passport answers `POST /sessions`, `POST /sessions/challenges`,
 *   `GET|DELETE /sessions/current`, and `GET|POST /sessions/peer` when it is
 *   mounted. Those Express routes are registered ahead of the catch-all, so
 *   they answer first. `GET /sessions` stays this collection.
 * - `GET /services/peering` is peering capability, not this peer roster.
 * - `/delegations` and `/services/delegation` are the delegation mounts.
 *
 * @see functions/applicationResourceContract.js
 * @see @fabric/core/docs/CONTRACTS.md
 */

const Service = require('@fabric/core/types/service');

/**
 * Resources the edge application contract always offers.
 * `routes` are the HTTP paths. `properties` are the collection schema.
 * @type {Object<string, Object>}
 */
const RESOURCES = Object.freeze({
  Session: Object.freeze({
    description: 'Application session collection at /sessions. A create is an Entity of type Session. A mounted Passport handler answers POST /sessions, GET|DELETE /sessions/current, and /sessions/peer first.',
    routes: Object.freeze({ list: '/sessions', view: '/sessions/:id' })
  }),
  Peer: Object.freeze({
    description: 'Application peer roster at /peers. address is required. This is not GET /services/peering.',
    properties: Object.freeze({
      address: Object.freeze({ type: 'string', required: true })
    }),
    routes: Object.freeze({ list: '/peers', view: '/peers/:id' })
  }),
  Entity: Object.freeze({
    description: 'Content-addressed document at /entities/:id. The item id is the entity hash.',
    routes: Object.freeze({ list: '/entities', view: '/entities/:id' })
  })
});

class ApplicationService extends Service {
  /**
   * @param {Object} [settings]
   */
  constructor (settings = {}) {
    super(settings);
    this.settings = Object.assign({
      name: 'ApplicationService'
    }, settings);
    this.http = null;
    this.bound = false;
  }

  /**
   * Resource descriptors this service mounts. Same object `define()` receives.
   * @returns {Object<string, Object>}
   */
  resources () {
    return RESOURCES;
  }

  /**
   * Define each application resource on a FabricHTTPServer.
   * Call this before `start()`. A second bind throws, because `define()`
   * refuses overlapping paths.
   * @param {Object} httpServer FabricHTTPServer (`define`).
   * @returns {Promise<Object>} The same server.
   */
  async bind (httpServer) {
    if (!httpServer || typeof httpServer.define !== 'function') {
      throw new TypeError('ApplicationService.bind requires a FabricHTTPServer');
    }
    if (this.bound) {
      throw new Error('ApplicationService is already bound');
    }
    const names = Object.keys(RESOURCES);
    for (let i = 0; i < names.length; i++) {
      const name = names[i];
      await httpServer.define(name, RESOURCES[name]);
    }
    this.http = httpServer;
    this.bound = true;
    return httpServer;
  }
}

module.exports = ApplicationService;
module.exports.RESOURCES = RESOURCES;
