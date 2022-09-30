 'use strict';

const Service = require('@fabric/core/types/service');
const SPA = require('../types/spa');

/**
 * Implements a full-capacity (Native + Edge nodes) for a Fabric Site. 
 */
class Site extends Service {
  /**
   * Creates an instance of the {@link Site}, which provides general statistics covering a target Fabric node.
   * @param {Object} [settings] Configuration values for the {@link Site}.
   * @returns {Site} Instance of the {@link Site}.  Call `render(state)` to derive a new DOM element.
   */
  constructor (settings = {}) {
    // Adopt Fabric semantics
    super(settings);

    // Define local settings
    this.settings = Object.assign({
      authority: 'http://localhost:9332/services/fabric', // loopback service
      spa: null
    }, this.settings, settings);

    // Set local state
    this._state = {
      content: {},
      status: 'PAUSED'
    };

    this.spa = new SPA(this.settings.spa);

    // Ensure chainability
    return this;
  }

  async compute (next = {}) {
    this.state = Object.assign(this.state, next);
    this.next = this.commit();
    this.emit('commit', this.next);
    return this;
  }
}

module.exports = Site;
