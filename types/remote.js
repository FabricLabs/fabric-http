'use strict';

// Constants
const {
  HTTP_HEADER_CONTENT_TYPE,
  P2P_CALL
} = require('@fabric/core/constants');

// Local Constants
const { PREFERRED_CONTENT_TYPE } = require('../constants');

// Dependencies
const querystring = require('querystring');

// External Dependencies
const fetch = require('cross-fetch');
const parser = require('content-type');
const WebSocket = require('isomorphic-ws');

// Fabric Types
// const Message = require('@fabric/core/types/message');
const FabricRemote = require('@fabric/core/types/remote');

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

  /**
   * Make an HTTP request to the configured authority.
   * @param {String} type One of `GET`, `PUT`, `POST`, `DELETE`, or `OPTIONS`.
   * @param {String} path The path to request from the authority.
   * @param {Object} [params] Options.
   * @returns {FabricHTTPResult}
   */
  async request (type, path, params = {}) {
    const self = this;

    let url = this.authority + path;
    let result = null;
    let response = null;
    let headers = {
      'Accept': PREFERRED_CONTENT_TYPE,
      'Content-Type': HTTP_HEADER_CONTENT_TYPE
    };

    if (params.headers) {
      headers = Object.assign({}, headers, params.headers);
    }

    if (this.settings.macaroon) {
      headers = Object.assign({}, headers, {
        'Macaroon': this.settings.macaroon,
        'EncodingType': 'hex'
      });
    }

    let opts = {
      method: type,
      headers: headers
    };

    // TODO: break out into independent auth module
    if (this.settings.username || this.settings.password) {
      headers['Authorization'] = `Basic ${Buffer.from([
        this.settings.username || '',
        this.settings.password || ''
      ].join(':')).toString('base64')}`;
    }

    switch (params.mode) {
      case 'query':
        url += '?' + querystring.stringify(params.body);
        break;
      default:
        try {
          opts.body = JSON.stringify(params.body);
        } catch (exception) {
          console.error('[FABRIC:REMOTE] Could not prepare request:', exception);
        }

        opts = Object.assign(opts, {
          body: params.body || null
        });
        break;
    }

    // Core Logic
    this.emit('warning', `Requesting: ${url} ${opts}`);

    try {
      response = await fetch(url, opts);
    } catch (e) {
      self.emit('error', `[REMOTE] exception: ${e}`);
    }

    if (!response) {
      return {
        status: 'error',
        message: 'No response to request.'
      };
    }

    switch (response.status) {
      case 404:
        result = {
          status: 'error',
          message: 'Document not found.'
        };
        break;
      default:
        if (response.ok) {
          const formatter = parser.parse(response.headers.get('content-type'));
          switch (formatter.type) {
            case 'application/json':
              try {
                result = await response.json();
              } catch (E) {
                console.error('[REMOTE]', 'Could not parse JSON:', E);
              }

              if (response.headers.get('x-pagination')) {
                console.debug('Has pagination:', response.headers);
              }
              break;
            default:
              if (this.settings.verbosity >= 4) self.emit('warning', `[FABRIC:REMOTE] Unhandled headers content type: ${formatter.type}`);
              result = await response.text();
              break;
          }
        } else {
          if (this.settings.verbosity >= 4) console.warn('[FABRIC:REMOTE]', 'Unmanaged HTTP status code:', response.status);

          try {
            result = response.json();
          } catch (exception) {
            result = response.text();
          }
        }
        break;
    }

    return result;
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
