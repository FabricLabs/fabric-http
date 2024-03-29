'use strict';

// TODO: audit this library
const WebSocket = require('isomorphic-ws');
const URL = require('url');

// Fabric Types
const Service = require('@fabric/core/types/service');
const Message = require('@fabric/core/types/message');

// Internal Types
const Remote = require('./remote');

// Components
// const FabricBridge = require('../components/FabricBridge');

/**
 * The {@link Bridge} type extends a Fabric application to the web.
 */
class Bridge extends Service {
  /**
   * Create an instance of the bridge by providing a host.
   * @param {Object} [settings] Settings for the bridge.
   * @returns {Bridge} Instance of the bridge.
   */
  constructor (settings = {}) {
    super(settings);

    // const bridge = new FabricBridge(this.settings);
    const bridge = null;

    // Assign settings
    this.settings = Object.assign({
      authority: 'localhost',
      document: bridge,
      port: 9999,
      path: './stores/bridge',
      reconnect: true
    }, this.settings, settings);

    // Raw socket tracking
    this.websocket = null;

    // Track bound functions
    this._boundFunctions = {};
    this._remotes = [];

    return this;
  }

  /**
   * Attempt to connect to the target host.
   * @returns {Bridge} Instance of the bridge.
   */
  async connect () {
    if (this.settings.verbosity >= 3) console.log('[WEB:BRIDGE]', 'Connecting...');
    if (this.websocket) {
      console.log('[WEB:BRIDGE]', 'Already connected!  Using existing socket.');
      return this.websocket;
    }

    // TODO: document significance of `/` as the document
    // Used for subscribing to all state paths for the host.
    // TODO: secure
    const protocol = (this.settings.secure) ? 'wss' : 'ws';

    // Instance of the WebSocket
    this.websocket = new WebSocket(`${protocol}://${this.settings.hostname}:${this.settings.port}/`);

    // Track bound functions in _boundFunctions
    this._boundFunctions['onopen'] = this._handleSuccessfulConnection.bind(this);
    this._boundFunctions['onclose'] = this._handleConnectionClose.bind(this);
    this._boundFunctions['onmessage'] = this._handleHostMessage.bind(this);
    this._boundFunctions['onerror'] = this._handleHostError.bind(this);

    // Assign bound functions to the WebSocket
    this.websocket.onopen = this._boundFunctions['onopen'];
    this.websocket.onclose = this._boundFunctions['onclose'];
    this.websocket.onmessage = this._boundFunctions['onmessage'];
    this.websocket.onerror = this._boundFunctions['onerror'];

    // Ensure chainability
    return this;
  }
 
  async start () {
    // TODO: reconsider inheriting from Service
    // await super.start();
    if (this.settings && this.settings.hubs && this.settings.hubs.length) {
      if (this.settings.verbosity >= 4) console.log('[HTTP:BRIDGE]', 'Connecting to Hubs:', this.settings.hubs);
      for (let i = 0; i < this.settings.hubs.length; i++) {
        try {
          const hub = this.settings.hubs[i];
          const parts = URL.parse(hub);
          const remote = new Remote({
            authority: parts.hostname,
            port: parts.port,
            secure: (parts.protocol === 'https:') ? true : false
          });

          const options = await remote._OPTIONS('/');
          if (this.settings.verbosity >= 4) console.log('[HTTP:BRIDGE]', 'Got options from Remote:', options);

          this._remotes.push(remote);
        } catch (exception) {
          console.error('Could not connect to remote:', exception);
        }
      } 
    }
 
    await this.connect();
  }

  async stop () {
    this.settings.reconnect = false;
    await super.stop();
  }

  async send (msg) {
    if (this.settings.verbosity >= 4) console.log('[HTTP:BRIDGE]', 'Sending input to WebSocket:', typeof msg, msg);
    this.websocket.send(msg);
  }

  /**
   * Request a Document from our Peers.
   * @param {Object} request Request to send. 
   * @param {String} request.path Document path.
   */
  async query (request = { path: '/' }) {
    if (typeof request === 'string') request = { path: request };
    if (!request.path) throw new Error('Request must have "path" property.');

    let results = [];

    // Remotes as first promises
    const promises = this._remotes.map((remote) => {
      return remote._GET(request.path);
    });

    // Remotes first..
    try {
      results = await Promise.all(promises);
    } catch (exception) {
      console.error('Could not query:', request, exception);
    }

    console.log('got results:', results);

    return results;
  }

  async _handleSuccessfulConnection () {
    if (this.settings.verbosity >= 2) console.log('[HTTP:BRIDGE]', 'Successful connection...');
    const now = Date.now();
    const message = Message.fromVector(['Ping', now.toString()]);
    const ping = JSON.stringify(message.toObject());
    console.log('ping:', typeof ping, ping);
    // if (this.settings.verbosity >= 5) console.log('[HTTP:BRIDGE]', 'Message To Send:', typeof message, message, message.asRaw());
    this.websocket.send(message.asRaw());
    this.emit('connected');
  }

  async _handleHostMessage (msg) {
    // if (this.settings.verbosity >= 4) console.log('[HTTP:BRIDGE]', 'Host message:', msg);
    // if (this.settings.verbosity >= 2) console.log('[HTTP:BRIDGE]', 'Host message data:', typeof msg.data, msg.data);
    let message = null;

    if (!msg.type && msg['@type']) msg.type = msg['@type'];
    if (!msg.data && msg['@data']) msg.data = msg['@data'];

    try {
      message = JSON.parse(msg.data);
    } catch (exception) {
      if (this.settings.verbosity >= 3) console.error('[HTTP:BRIDGE]', 'Could not parse message data as JSON:', msg.data);
    }

    // TODO: binary parsing
    if (!message) {
      try {
        message = Message.fromRaw(msg.data);
      } catch (exception) {
        if (this.settings.verbosity >= 3) console.error('[HTTP:BRIDGE]', 'Could not parse message data as binary:', msg.data, exception);
      }

    }

    if (!message) throw new Error(`Input could not be processed: ${typeof msg} ${msg}`);
    this.emit('message', message);
  }

  async _handleConnectionClose () {
    if (this.settings.verbosity >= 2) console.log('[HTTP:BRIDGE]', 'Connection closed.');
    const bridge = this;

    bridge.websocket = null;
    bridge._retryTime = 0;

    if (bridge.settings.reconnect) {
      bridge._retryTimeout = setTimeout(function () {
        bridge.connect();
      }, 1000);
    }
  }

  async _handleHostError (err) {
    this.websocket.onerror = this._handleHostError.bind(this);
  }
}

module.exports = Bridge;
