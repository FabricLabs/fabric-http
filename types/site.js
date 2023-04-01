 'use strict';

// Fabric Types
const Actor = require('@fabric/core/types/actor');
const Peer = require('@fabric/core/types/peer');
const Service = require('@fabric/core/types/service');

// Internal Types
// const Bridge = require('../types/bridge');
const SPA = require('./spa');

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
      fabric: {
        name: '@sites/default'
      },
      spa: null
    }, this.settings, settings);

    // Set local state
    this._state = {
      content: {
        title: 'Default Site'
      },
      status: 'PAUSED'
    };

    this.peer = new Peer(this.settings.fabric);
    this.spa = new SPA(this.settings.spa);

    // this.bridge = new Bridge();

    // Ensure chainability
    return this;
  }

  render (state = this.state) {
    const html = `<fabric-debug>Hello, world!</fabric-debug>`;
    return this.spa._renderWith(html);
  }

  async compute (next = {}) {
    this._state.content.status = 'COMPUTING';
    const state = Object.assign(this.state, next);
    const actor = new Actor({
      type: 'Cycle',
      object: state
    });

    this.next = this.commit();
    this._state.content.status = 'COMPUTED';

    this.emit('cycle', actor);

    return this;
  }

  async start () {
    this.trust(this.peer, 'AGENT');
    await this.peer.start();
    return this;
  }
}

module.exports = Site;
