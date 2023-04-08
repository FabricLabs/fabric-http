'use strict';

// External Dependencies
const WebSocket = require('isomorphic-ws');

// Fabric Types
// const Message = require('@fabric/core/types/message');
const FabricRemote = require('@fabric/core/types/remote');

const CONTENT_TYPE = 'application/json';

/**
 * Interact with a remote {@link Resource}.  This is currently the only
 * HTTP-related code that should remain in @fabric/core — all else must
 * be moved to @fabric/http before final release!
 * @type {Remote}
 * @property {Object} settings
 * @property {Boolean} secure
 */
class Remote extends FabricRemote {
  /**
   * An in-memory representation of a node in our network.
   * @param {Object} target Target object.
   * @param {String} target.host Named host, e.g. "localhost".
   * @param {String} target.secure Require TLS session.
   * @constructor
   */
  constructor (config = {}) {
    super(config);

    this.settings = Object.assign({
      backoff: 2,
      entropy: Math.random(),
      macaroon: null,
      secure: true,
      state: {
        status: 'PAUSED'
      },
      host: 'hub.fabric.pub',
      port: 443
    }, config);

    this.host = this.settings.host || this.settings.authority;
    this.port = this.settings.port;
    this.secure = this.settings.secure;
    this.socket = null;

    this.endpoint = `${(this.secure) ? 'wss' : 'ws'}:${this.host}:${this.port}/`;

    this._nextReconnect = 0;
    this._reconnectAttempts = 0;
    this._state = {
      content: this.settings.state,
      status: 'PAUSED',
      messages: [],
      meta: {
        messages: {
          count: 0
        }
      }
    };

    return this;
  }

  get _socketURL () {
    return `ws${(this.secure) ? 's' : ''}://${this.host}:${this.port}`;
  }

  _handleSocketOpen () {
    console.log('socket open!');

    /* const INV_MSG = Message.fromVector(['INVENTORY_REQUEST', {
      created: (new Date()).toISOString()
    }]);

    this.socket.send(INV_MSG.toBuffer()); */
  }

  _handleSocketClose () {
    console.log('socket closed!');
  }

  _handleSocketMessage (msg) {
    console.log('socket message:', msg);
    /* const message = Message.fromBuffer(msg);
    console.log('parsed:', message);
    switch (message.type) {
      default:
        this.emit('error', `Unhandled message type: ${message.type}`);
        break;
    } */
  }

  async start () {
    this._state.status = 'STARTING';
    this.socket = new WebSocket(this._socketURL);

    this.socket.onopen = this._handleSocketOpen.bind(this);
    this.socket.onclose = this._handleSocketClose.bind(this);
    this.socket.onmessage = this._handleSocketMessage.bind(this);

    this._state.status = 'STARTED';
    this.commit();

    return this;
  }
}

module.exports = Remote;
