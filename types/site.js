 'use strict';

// Fabric Types
const path = require('path');
const Actor = require('@fabric/core/types/actor');
const { composeFile, loadReferenceComponents } = require('../functions/compose');

// Internal Types
// const Bridge = require('../types/bridge');
const SPA = require('./spa');

/**
 * Implements a full-capacity (Native + Edge nodes) for a Fabric Site. 
 */
class Site extends Actor {
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
      handle: 'fabric-site',
      authority: 'http://localhost:9332/services/fabric', // loopback service
      fabric: {
        alias: '@sites/fabric'
      },
      state: {
        title: 'Default Site'
      },
      spa: null
    }, this.settings, settings);

    // Set local state
    this._state = {
      content: this.settings.state,
      status: 'PAUSED'
    };

    // Fabric Components
    this.spa = new SPA(this.settings);
    // this.bridge = new Bridge();

    // Ensure chainability
    return this;
  }

  get handle () {
    return this.settings.handle;
  }

  render (state = this.state) {
    const html = this._getHTML(state);
    if (/<html[\s>]/i.test(html)) return html;
    return this.spa._renderWith(html);
  }

  toHTML () {
    return this.render();
  }

  _getHTML (state) {
    loadReferenceComponents();
    const current = Object.assign({}, this.state || {}, state || {});
    return composeFile(path.join(__dirname, '../views/site.jade'), {
      title: current.title || this.title || 'Example Application',
      language: 'en',
      bundleHash: (current.bundle && current.bundle.fullhash) || '',
      messages: current.messages || [],
      logs: current.logs || []
    }, {
      basedir: path.join(__dirname, '../views')
    });
  }

  _renderWith (html) {
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
