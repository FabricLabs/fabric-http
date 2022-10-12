 'use strict';

// Fabric Types
const Peer = require('@fabric/core/types/peer');
const Service = require('@fabric/core/types/service');

// Internal Types
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

    // Ensure chainability
    return this;
  }

  render (state = this.state) {
    return `
      <!DOCTYPE html>
      <html>
        <head>
          <title>${state.title}</title>
        </head>
        <body>
          <div id="fabric-container">
            <p>Loading...</p>
          </div>
          <fabric-site></fabric-site>
          <script src="bundles/browser.js" data-fullhash="${(state.bundle) ? state.bundle.fullhash : ''}"></script>
        </body>
      </html>`;
  }

  async compute (next = {}) {
    this.state = Object.assign(this.state, next);
    this.next = this.commit();
    this.emit('commit', this.next);
    return this;
  }

  async start () {
    this.trust(this.peer, 'AGENT');
    await this.peer.start();
    return this;
  }
}

module.exports = Site;
