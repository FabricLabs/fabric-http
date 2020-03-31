'use strict';

const {
  HTTP_SERVER_PORT,
  HTTPS_SERVER_PORT,
  MAXIMUM_PING,
  WEBSOCKET_KEEPALIVE
} = require('../constants');

// trusted community modules
// const fs = require('fs');
const http = require('http');
// const crypto = require('crypto');
// TODO: remove Express entirely...
// NOTE: current blockers include PeerServer...
const express = require('express');
const session = require('express-session');
// TODO: check with Riddle about this
const parsers = require('body-parser');
const monitor = require('fast-json-patch');
const extractor = require('express-bearer-token');
const pluralize = require('pluralize');
const stoppable = require('stoppable');

// Pathing
const pathToRegexp = require('path-to-regexp').pathToRegexp;

// Core components
const Oracle = require('@fabric/core/types/oracle');
const Collection = require('@fabric/core/types/collection');
// const Resource = require('@fabric/core/types/resource');
const Message = require('@fabric/core/types/message');
const State = require('@fabric/core/types/state');

// const App = require('./app');
// const Client = require('./client');
// const Component = require('./component');
const SPA = require('./spa');

// Dependencies
const WebSocket = require('ws');
const PeerServer = require('peer').ExpressPeerServer;

/**
 * The primary web server.
 * @extends Oracle
 */
class HTTPServer extends Oracle {
  /**
   * Create an instance of the HTTP server.
   * @param  {Object} [settings={}] Configuration values.
   * @return {HTTPServer} Fully-configured instance of the HTTP server.
   */
  constructor (settings = {}) {
    super(settings);

    this.settings = Object.assign({
      name: 'FabricHTTPServer',
      host: '0.0.0.0',
      path: './stores/server',
      port: HTTP_SERVER_PORT,
      listen: true,
      resources: {},
      components: {},
      services: {},
      seed: Math.random(),
      sessions: false,
      verbose: false
    }, settings);

    this.connections = {};
    this.definitions = {};
    this.stores = {};

    this.app = new SPA(Object.assign({}, this.settings, {
      path: './stores/server-application'
    }));

    /* this.compiler = webpack({
      // webpack options
    }); */

    this.wss = null;
    this.http = null;
    this.express = express();
    this.sessions = session({
      resave: true,
      saveUninitialized: false,
      secret: this.settings.seed
    });

    this._state = {};
    this.observer = monitor.observe(this.state);
    this.coordinator = new PeerServer(this.express, {
      path: '/services/peering'
    });

    this.collections = [];
    this.routes = [];
    this.customRoutes = [];

    return this;
  }

  get state () {
    return this._state;
  }

  set state (value) {
    this._state = value;
  }

  async commit () {
    ++this.clock;

    this['@parent'] = this.id;
    this['@preimage'] = this.toString();
    this['@constructor'] = this.constructor;

    if (this.observer) {
      this['@changes'] = monitor.generate(this.observer);
    }

    this['@id'] = this.id;

    if (this['@changes'] && this['@changes'].length) {
      const message = {
        '@type': 'Transaction',
        '@data': {
          'changes': this['@changes'],
          'state': this.state
        }
      };

      this.emit('changes', this['@changes']);
      this.emit('state', this.state);
      this.emit('message', message);

      // Broadcast to connected peers
      this.broadcast(message);
    }

    return this;
  }

  /**
   * Define a {@link Type} by name.
   * @param  {String} name       Human-friendly name of the type.
   * @param  {Definition} definition Configuration object for the type.
   * @return {HTTPServer}            Instance of the configured server.
   */
  async define (name, definition) {
    if (this.settings.verbosity >= 4) console.log('[WEB:SERVER]', 'Defining:', name, definition);

    let store = new Collection(definition);
    let resource = await super.define(name, definition);
    let snapshot = Object.assign({
      names: { plural: pluralize(name) }
    }, resource);
    let address = snapshot.routes.list.split('/')[1];

    this.stores[name] = store;
    this.definitions[name] = snapshot;
    this.collections.push(snapshot.routes.list);

    this.routes.push({
      path: snapshot.routes.view,
      route: pathToRegexp(snapshot.routes.view),
      resource: name
    });

    this.routes.push({
      path: snapshot.routes.list,
      route: pathToRegexp(snapshot.routes.list),
      resource: name
    });

    // TODO: document pathing
    this.state[address] = {};

    if (this.settings.verbosity >= 4) console.log('[WEB:SERVER]', 'Routes:', this.routes);
    return this;
  }

  broadcast (message) {
    let peers = Object.keys(this.connections);
    for (let i = 0; i < peers.length; i++) {
      try {
        this.connections[peers[i]].send(JSON.stringify(message));
      } catch (E) {
        console.error('Could not send message to peer:', E);
      }
    }
  }

  trust (source) {
    source.on('message', function (msg) {
      console.log('[HTTP:SERVER]', 'trusted source:', source.constructor.name, 'sent message:', msg);
    });
  }

  /**
   * Connection manager for WebSockets.  Called once the handshake is complete.
   * @param  {WebSocket} socket The associated WebSocket.
   * @param  {http.IncomingMessage} request Incoming HTTP request.
   * @return {WebSocket} Returns the connected socket.
   */
  _handleWebSocket (socket, request) {
    // console.log('incoming WebSocket:', socket);
    let server = this;

    // TODO: check security of common defaults for `sec-websocket-key` params
    // Chrome?  Firefox?  Safari?  Opera?  What defaults do they use?
    let buffer = Buffer.from(request.headers['sec-websocket-key'], 'base64');
    let handle = buffer.toString('hex');
    let player = new State({
      connection: buffer.toString('hex'),
      entropy: buffer.toString('hex')
    });

    socket._resetKeepAlive = function () {
      clearInterval(socket._heartbeat);
      socket._heartbeat = setInterval(function () {
        let now = Date.now();
        let message = Message.fromVector(['Ping', now.toString()]);
        // TODO: refactor _sendTo to accept Message type
        let ping = JSON.stringify(message.toObject());

        try {
          server._sendTo(handle, ping);
        } catch (exception) {
          console.error('could not ping peer:', handle, exception);
        }
      }, WEBSOCKET_KEEPALIVE);
    };

    socket._timeout = null;
    socket._resetKeepAlive();

    // Clean up memory when the connection has been safely closed (ideal case).
    socket.on('close', function () {
      delete server.connections[player['@data'].connection];
    });

    // TODO: message handler on base class
    socket.on('message', async function handler (msg) {
      console.log('[SERVER:WEBSOCKET]', 'incoming message:', typeof msg, msg);

      let message = null;
      let type = null;

      if (msg.type && msg.data) {
        console.log('spec:', {
          type: msg.type,
          data: msg.data
        });
      }

      try {
        message = Message.fromRaw(msg);
        type = message.type;
      } catch (exception) {
        console.error('could not parse message:', exception);
      }

      if (!message) {
        // Fall back to JSON parsing
        try {
          if (msg instanceof Buffer) {
            msg = msg.toString('utf8');
          }

          message = JSON.parse(msg);
          type = message['@type'];
        } catch (E) {
          console.error('could not parse message:', typeof msg, msg, E);
          // TODO: disconnect from peer
          console.warn('you should disconnect from this peer:', handle);
        }
      }

      switch (type) {
        default:
          console.log('[SERVER]', 'unhandled type:', type);
          break;
        case 'GET':
          let answer = await server._GET(message['@data']['path']);
          console.log('answer:', answer);
          return answer;
        case 'POST':
          let link = await server._POST(message['@data']['path'], message['@data']['value']);
          console.log('[SERVER]', 'posted link:', link);
          break;
        case 'PATCH':
          let result = await server._PATCH(message['@data']['path'], message['@data']['value']);
          console.log('[SERVER]', 'patched:', result);
          break;
        case 'Ping':
          let now = Date.now();
          let local = Message.fromVector(['Pong', now.toString()]);
          let pong = JSON.stringify(local.toObject());
          return server._sendTo(handle, pong);
        case 'Pong':
          socket._resetKeepAlive();
          return;
          break;
        case 'Call':
          server.emit('call', {
            method: message['@data'].data.method,
            params: message['@data'].data.params
          });
          break;
      }

      // TODO: enable relays
      // server._relayFrom(handle, msg);

      // always send a receipt of acknowledgement
      socket.send(JSON.stringify({
        '@type': 'Receipt',
        '@actor': handle,
        '@data': message,
        '@version': 1
      }));
    });

    // set up an oracle, which listens to patches from server
    socket.oracle = server.on('patches', function (patches) {
      console.log('magic oracle patches:', patches);
    });

    // insert connection to library
    server.connections[player['@data'].connection] = socket;
    // server.players[player['@data'].connection] = player;

    // send result
    socket.send(JSON.stringify({
      '@type': 'VerAck',
      '@version': 1
    }));

    socket.send(JSON.stringify({
      '@type': 'Inventory',
      '@parent': this.app.id,
      '@version': 1
    }));

    socket.send(JSON.stringify({
      '@type': 'State',
      '@data': this.app.state,
      '@version': 1
    }));

    return socket;
  }

  _sendTo (actor, msg) {
    console.log('[SERVER:WEBSOCKET]', 'sending message to actor', actor, msg);
    let target = this.connections[actor];
    if (!target) throw new Error('No such target.');
    let result = target.send(msg);
  }

  _relayFrom (actor, msg) {
    let peers = Object.keys(this.connections).filter(key => {
      return key !== actor;
    });

    this.log(`relaying message from ${actor} to peers:`, peers);

    for (let i = 0; i < peers.length; i++) {
      try {
        this.connections[peers[i]].send(msg);
      } catch (E) {
        console.error('Could not relay to peer:', E);
      }
    }
  }

  /**
   * Special handler for first-page requests.
   * @param {HTTPRequest} req Incoming request.
   * @param {HTTPResponse} res Outgoing response.
   */
  _handleIndexRequest (req, res) {
    console.log('[HTTP:SERVER]', 'Handling request for Index...');
    let html = this.app.render(this.state);
    console.log('[HTTP:SERVER]', 'Generated HTML:', html);
    res.set('Content-Type', 'text/html');
    res.send(`${html}`);
  }

  _handleOptionsRequest (req, res) {
    res.send({
      name: this.settings.name,
      description: this.settings.description,
      resources: this.definitions
    });
  }

  _logMiddleware (req, res, next) {
    if (!this.settings.verbosity < 2) return next();
    // TODO: switch to this.log
    console.log([
      `${req.host}:${this.settings.port}`,
      req.hostname,
      req.user,
      `"${req.method} ${req.path} HTTP/${req.httpVersion}"`,
      res.statusCode,
      res.getHeader('content-length')
    ].join(' '));
    return next();
  }

  _headerMiddleware (req, res, next) {
    res.header('X-Powered-By', '@fabric/http');
    return next();
  }

  _verifyClient (info, done) {
    console.log('[HTTP:SERVER]', '_verifyClient', info);
    if (!this.settings.sessions) return done();
    this.sessions(info.req, {}, () => {
      // TODO: reject unknown (!info.req.session.identity)
      done();
    });
  }

  /**
   * Add a route manually.
   * @param {String} method  HTTP verb.
   * @param {String} path    HTTP route.
   * @param {Function} handler HTTP handler (req, res, next)
   */
  _addRoute (method, path, handler) {
    if (this.settings.verbosity >= 4) console.log('[HTTP:SERVER]', 'Adding route:', path);
    this.customRoutes.push({ method, path, handler });
  }

  _roleMiddleware (req, res, next) {
    next();
  }

  async _applyChanges (ops) {
    try {
      monitor.applyPatch(this.state, ops);
      await this.commit();
    } catch (E) {
      this.error('Error applying changes:', E);
    }

    return this;
  }

  async _handleRoutableRequest (req, res, next) {
    if (this.settings.verbosity >= 5) console.log('[HTTP:SERVER]', 'Handling routable request:', req.method, req.path);
    const server = this;
    let result = null;
    let route = null;
    let resource = null;

    switch (req.method.toUpperCase()) {
      // Discard unhandled methods
      default:
        return next();
      case 'HEAD':
        let existing = await this._GET(req.path);
        if (!existing) return res.status(404).end();
        break;
      case 'GET':
        for (let i in this.routes) {
          let local = this.routes[i];
          if (req.path.match(local.route)) {
            result = await this.stores[local.resource].get(req.path);
            route = local;
            resource = local.resource;
            break;
          }
        }

        if (result) break;

        let content = await this._GET(req.path);
        result = content;
        if (!result) return res.status(404).end();
        break;
      case 'PUT':
        result = await this._PUT(req.path, req.body);
        break;
      case 'POST':
        for (let i in this.routes) {
          let local = this.routes[i];
          if (req.path.match(local.route)) {
            result = await this.stores[local.resource].create(req.body);
            route = local;
            resource = local.resource;
            break;
          }
        }

        if (!result) return res.status(500).end();
        let link = await this._POST(req.path, result);
        return res.redirect(303, link);
      case 'PATCH':
        let patch = await this._PATCH(req.path, req.body);
        result = patch;
        break;
      case 'DELETE':
        await this._DELETE(req.path);
        return res.sendStatus(204);
      case 'OPTIONS':
        return res.send({
          '@type': 'Error',
          '@data': 'Not yet supported.'
        });
    }

    res.format({
      json: function () {
        res.header('Content-Type', 'application/json');
        return res.send(result);
      },
      html: function () {
        // TODO: re-enable for HTML
        // let output = server.app._loadHTML(resource.render(result));
        // return res.send(server.app._renderWith(output));

        // TODO: re-write above code, render app with data
        res.header('Content-Type', 'application/json');
        return res.send(result);
      }
    });
  }

  async start () {
    if (this.settings.verbosity >= 4) console.log('[HTTP:SERVER]', 'Starting...');
    const server = this;
    server.status = 'starting';

    for (let name in server.settings.resources) {
      const definition = server.settings.resources[name];
      const resource = await server.define(name, definition);
      if (server.settings.verbosity >= 5) console.log('[AUDIT]', 'Created resource:', resource);
    }

    try {
      await server.app.start();
    } catch (E) {
      console.error('Could not start server app:', E);
    }

    // configure router
    server.express.use(server._logMiddleware.bind(server));
    server.express.use(server._headerMiddleware.bind(server));

    // TODO: defer to an in-memory datastore for requested files
    // NOTE: disable this line to compile on-the-fly
    server.express.use(express.static('assets'));
    server.express.use(extractor());
    server.express.use(server._roleMiddleware.bind(server));

    // configure sessions & parsers
    // TODO: migrate to {@link Session} or abolish entirely
    if (server.settings.sessions) server.express.use(server.sessions);

    // Other Middlewares
    server.express.use(parsers.urlencoded({ extended: true }));
    server.express.use(parsers.json());

    // TODO: render page
    server.express.options('/', server._handleOptionsRequest.bind(server));
    // TODO: enable this route by disabling or moving the static asset handler above
    // NOTE: see `server.express.use(express.static('assets'));`
    server.express.get('/', server._handleIndexRequest.bind(server));

    // handle custom routes.
    // TODO: abolish this garbage in favor of resources.
    for (let i = 0; i < server.customRoutes.length; i++) {
      let route = server.customRoutes[i];
      switch (route.method.toLowerCase()) {
        case 'get':
        case 'put':
        case 'post':
        case 'patch':
        case 'delete':
          server.express[route.method.toLowerCase()](route.path, route.handler);
          break;
      }
    }

    // Attach the internal router
    server.express.get('/*', server._handleRoutableRequest.bind(server));
    server.express.put('/*', server._handleRoutableRequest.bind(server));
    server.express.post('/*', server._handleRoutableRequest.bind(server));
    server.express.patch('/*', server._handleRoutableRequest.bind(server));
    server.express.delete('/*', server._handleRoutableRequest.bind(server));
    server.express.options('/*', server._handleRoutableRequest.bind(server));

    // create the HTTP server
    server.http = stoppable(http.createServer(server.express), 0);

    // attach a WebSocket handler
    this.wss = new WebSocket.Server({
      server: server.http,
      // TODO: validate entire verification chain
      // verifyClient: this._verifyClient.bind(this)
    });

    // set up the WebSocket connection handler
    this.wss.on('connection', this._handleWebSocket.bind(this));

    if (this.settings.listen) {
    // TODO: test?
      await server.http.listen(this.settings.port, this.settings.host);
    } else {
      console.warn('[HTTP:SERVER]', 'Listening is disabled.  Only events will be emitted!');
    }

    this.status = 'started';

    // commit to our results
    // await this.commit();

    this.emit('ready');

    // TODO: include somewhere
    // console.log('[FABRIC:WEB]', 'You should consider changing the `host` property in your config,');
    // console.log('[FABRIC:WEB]', 'or set up a TLS server to encrypt traffic to and from this node.');
    if (this.settings.verbosity >= 4) console.log('[HTTP:SERVER]', 'Started!');

    return server;
  }

  async stop () {
    if (this.settings.verbosity >= 4) console.log('[HTTP:SERVER]', 'Stopping...');
    let server = this;
    this.status = 'stopping';

    try {
      await server.http.stop();
    } catch (E) {
      console.error('Could not stop HTTP listener:', E);
    }

    try {
      await server.app.stop();
    } catch (E) {
      console.error('Could not stop server app:', E);
    }

    this.status = 'stopped';
    server.emit('stopped');

    if (this.settings.verbosity >= 4) console.log('[HTTP:SERVER]', 'Stopped!');
    return server;
  }

  async _GET (path) {
    if (this.settings.verbosity >= 4) console.log('[HTTP:SERVER]', 'Handling GET to', path);
    let result = await this.app.store._GET(path);
    if (this.settings.verbosity >= 5) console.log('[HTTP:SERVER]', 'Retrieved:', result);
    if (!result && this.collections.includes(path)) result = [];
    return result;
  }

  async _PUT (path, data) {
    if (this.settings.verbosity >= 4) console.log('[HTTP:SERVER]', 'Handling PUT to', path, data);
    let result = await this.app.store._PUT(path, data);
    return result;
  }

  async _POST (path, data) {
    if (this.settings.verbosity >= 4) console.log('[HTTP:SERVER]', 'Handling POST to', path, data);
    return this.app.store._POST(path, data);
  }

  async _PATCH (path, data) {
    if (this.settings.verbosity >= 4) console.log('[HTTP:SERVER]', 'Handling PATCH to', path, data);
    return this.app.store._PATCH(path, data);
  }

  async _DELETE (path) {
    if (this.settings.verbosity >= 4) console.log('[HTTP:SERVER]', 'Handling DELETE to', path);
    return this.app.store._DELETE(path, data);
  }
}

module.exports = HTTPServer;
