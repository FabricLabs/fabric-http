/**
 * # Fabric HTTP Server
 * Implements an HTTP-capable server for a Fabric Application.
 */
'use strict';

// Constants
const {
  HTTP_SERVER_PORT,
  HTTPS_SERVER_PORT,
  MAXIMUM_PING,
  P2P_SESSION_ACK,
  WEBSOCKET_KEEPALIVE
} = require('../constants');

// Dependencies
const http = require('http');
const crypto = require('crypto');
const merge = require('lodash.merge');
const pluralize = require('pluralize');

// TODO: remove Express entirely...
// NOTE: current blockers include PeerServer...
const express = require('express');
const session = require('express-session');
const flasher = require('express-flash');
// TODO: check with Riddle about this
const parsers = require('body-parser');
const monitor = require('fast-json-patch');
const extractor = require('express-bearer-token');
const stoppable = require('stoppable');

// GraphQL
// const { GraphQLSchema, GraphQLObjectType, GraphQLString } = require('graphql');
// const graphql = require('graphql-http/lib/use/http').createHandler;

// Pathing
const pathToRegexp = require('path-to-regexp').pathToRegexp;

// Fabric Types
const Actor = require('@fabric/core/types/actor');
// const Oracle = require('@fabric/core/types/oracle');
const Collection = require('@fabric/core/types/collection');
// const Resource = require('@fabric/core/types/resource');
const Service = require('@fabric/core/types/service');
const Message = require('@fabric/core/types/message');
const Entity = require('@fabric/core/types/entity');
const State = require('@fabric/core/types/state');
const Peer = require('@fabric/core/types/peer');

// Internal Types
const auth = require('../middlewares/auth');

// Internal Components
// const App = require('./app');
// const Client = require('./client');
// const Component = require('./component');
// const Browser = require('./browser');
const SPA = require('./spa');

// Dependencies
const WebSocket = require('ws');
const PeerServer = require('peer').ExpressPeerServer;

/**
 * Fabric Service for exposing an {@link Application} to clients over HTTP.
 * @extends Service
 */
class FabricHTTPServer extends Service {
  /**
   * Create an instance of the HTTP server.
   * @param {Object} [settings] Configuration values.
   * @param {String} [settings.name="FabricHTTPServer"] User-friendly name of this server.
   * @param {Number} [settings.port=9999] Port to listen for HTTP connections on.
   * @return {FabricHTTPServer} Fully-configured instance of the HTTP server.
   */
  constructor (settings = {}) {
    super(settings);

    // Assign defaults
    this.settings = merge({
      name: 'FabricHTTPServer',
      description: 'Service delivering a Fabric application across the HTTP protocol.',
      assets: 'assets',
      // TODO: document host as listening on all interfaces by default
      host: '0.0.0.0',
      path: './stores/server',
      port: HTTP_SERVER_PORT,
      listen: true,
      resources: {},
      components: {},
      middlewares: {},
      redirects: {},
      services: {
        audio: {
          address: '/devices/audio'
        }
      },
      // TODO: replace with crypto random
      seed: Math.random(),
      sessions: false,
      state: {
        status: 'PAUSED'
      }
    }, settings);

    this.connections = {};
    this.definitions = {};
    this.methods = {};
    this.stores = {};

    // ## Fabric Agent
    // Establishes network connectivity with Fabric.  Manages peers, connections, and messages.
    this.agent = new Peer({
      listen: false,
      networking: true,
      peers: this.settings.peers,
      state: this.settings.state,
      upnp: false
    });

    // this.browser = new Browser(this.settings);
    // TODO: compile & boot (load state) SPA (React + Redux?)
    this.app = new SPA(Object.assign({}, this.settings, {
      path: './stores/server-application'
    }));

    /* this.compiler = webpack({
      // webpack options
    }); */

    this.wss = null;
    this.http = null;
    this.graphQLSchema = null;
    this.collections = [];
    this.routes = [];
    this.customRoutes = [];
    this.keys = new Set();

    // Setup for Express application
    this.express = express();
    // TODO: enable cross-shard sessions
    this.sessions = session({
      resave: true,
      saveUninitialized: false,
      secret: this.settings.seed
    });

    // Local State Setup
    this._state = {};
    this.observer = monitor.observe(this.state);
    this.coordinator = new PeerServer(this.express, {
      path: '/services/peering'
    });

    return this;
  }

  get hostname () {
    return this.settings.hostname || 'localhost';
  }

  get interface () {
    return this.settings.interface || this.settings.host;
  }

  get link () {
    return `http://${this.settings.hostname}:${this.settings.port}`;
  }

  get port () {
    return this.settings.port || 9999;
  }

  async commit () {
    ++this.clock;

    this['@id'] = this.id;
    // TODO: define parent path
    // this['@parent'] = this.id;
    // this['@preimage'] = this.toString();
    this['@constructor'] = this.constructor;

    if (this.observer) {
      this['@changes'] = monitor.generate(this.observer);
    }

    if (this['@changes'] && this['@changes'].length) {
      const message = {
        '@type': 'Transaction',
        '@data': {
          changes: this['@changes'],
          state: this.state
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
   * @return {FabricHTTPServer}            Instance of the configured server.
   */
  async define (name, definition) {
    if (this.settings.verbosity >= 5) console.log('[HTTP:SERVER]', 'Defining:', name, definition);
    const server = this;

    // Stub out old Resource code (Maki)
    const resource = { type: 'Resource', object: { name, definition } };
    const plural = pluralize(name).toLowerCase();
    const snapshot = Object.assign({
      name: name,
      names: { plural },
      routes: {
        list: `/${plural}`,
        view: `/${plural}/:id`
      }
    }, resource);

    const address = snapshot.routes.list.split('/')[1];
    const store = new Collection(snapshot);

    if (this.settings.verbosity >= 6) console.debug('[HTTP:SERVER]', 'Collection as store:', store);
    if (this.settings.verbosity >= 6) console.debug('[HTTP:SERVER]', 'Snapshot:', snapshot);

    this.stores[name] = store;
    this.definitions[name] = snapshot;
    this.collections.push(snapshot.routes.list);
    this.keys.add(snapshot.routes.list);

    this.stores[name].on('error', async (error) => {
      console.error('[HTTP:SERVER]', '[ERROR]', error);
    });

    this.stores[name].on('warning', async (warning) => {
      console.warn('[HTTP:SERVER]', 'Warning:', warning);
    });

    this.stores[name].on('message', async (message) => {
      let entity = null;
      switch (message['@type']) {
        case 'Create':
          entity = new Entity({
            '@type': name,
            '@data': message['@data']
          });

          console.log('[HTTP:SERVER]', `Resource "${name}" created:`, entity.data);
          server.emit('message', entity.data);
          break;
        case 'Transaction':
          await server._applyChanges(message['@data'].changes);
          break;
        default:
          console.warn('[HTTP:SERVER]', 'Unhandled message type:', message['@type']);
          break;
      }

      server.broadcast({
        '@type': 'StateUpdate',
        '@data': server.state
      });
    });

    this.stores[name].on('commit', (commit) => {
      server.broadcast({
        '@type': 'StateUpdate',
        '@data': server.state
      });
    });

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

    // Also define on app
    await this.app.define(name, definition);

    // TODO: document pathing
    this.state[address] = {};
    this.app.state[address] = {};

    // if (this.settings.verbosity >= 4) console.log('[HTTP:SERVER]', 'Routes:', this.routes);
    return this;
  }

  async handleFabricMessage (message) {
    this.emit('debug', `Handling trusted Fabric message: ${message}`);
    // TODO: validation
    await this.agent.broadcast(message);
  }

  broadcast (message) {
    const peers = Object.keys(this.connections);

    // Send to all connected peers
    for (let i = 0; i < peers.length; i++) {
      const peer = peers[i];

      if (peer.status === 'connected') {
        // TODO: move send buffer here
      }

      try {
        this.connections[peer].send(message.toBuffer());
      } catch (E) {
        console.error('Could not send message to peer:', E);
      }
    }
  }

  debug (content) {
    console.debug('[FABRIC:EDGE]', (new Date().toISOString()), content);
  }

  log (content) {
    console.log('[FABRIC:EDGE]', (new Date().toISOString()), content);
  }

  trust (source) {
    super.trust(source);

    source.on('message', function (msg) {
      console.log('[HTTP:SERVER]', 'trusted source:', source.constructor.name, 'sent message:', msg);
    });
  }

  warn (content) {
    console.warn('[FABRIC:EDGE]', (new Date().toISOString()), content);
  }

  _registerMethod (name, method) {
    this.methods[name] = method.bind(this);
  }

  _handleAppMessage (msg) {
    console.trace('[HTTP:SERVER]', 'Internal app emitted message:', msg);
  }

  _handleCall (call) {
    if (!call.method) throw new Error('Call requires "method" parameter.');
    if (!call.params) throw new Error('Call requires "params" parameter.');
    if (!this.methods[call.method]) throw new Error(`Method "${call.method}" has not been registered.`);
    return this.methods[call.method].apply(this, call.params);
  }

  /**
   * Connection manager for WebSockets.  Called once the handshake is complete.
   * @param  {WebSocket} socket The associated WebSocket.
   * @param  {http.IncomingMessage} request Incoming HTTP request.
   * @return {WebSocket} Returns the connected socket.
   */
  _handleWebSocket (socket, request) {
    const server = this;

    // TODO: check security of common defaults for `sec-websocket-key` params
    // Chrome?  Firefox?  Safari?  Opera?  What defaults do they use?
    const buffer = Buffer.from(request.headers['sec-websocket-key'], 'base64');
    const handle = buffer.toString('hex');
    const player = new State({
      connection: buffer.toString('hex'),
      entropy: buffer.toString('hex')
    });

    socket._resetKeepAlive = function () {
      clearInterval(socket._heartbeat);
      socket._heartbeat = setInterval(function () {
        const now = Date.now();
        const ping = Message.fromVector(['Ping', now.toString()]);

        try {
          server._sendTo(handle, ping.toBuffer());
        } catch (exception) {
          console.error('could not ping peer:', handle, exception);
        }
      }, WEBSOCKET_KEEPALIVE);
    };

    socket._timeout = null;
    socket._resetKeepAlive();

    // Clean up memory when the connection has been safely closed (ideal case).
    socket.on('close', function () {
      clearInterval(socket._heartbeat);
      delete server.connections[player['@data'].connection];
    });

    // TODO: message handler on base class
    socket.on('message', async function handler (msg) {
      // console.log('[SERVER:WEBSOCKET]', 'incoming message:', typeof msg, msg);

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
          type = message['@type'] || message.type;
        } catch (E) {
          console.error('could not parse message:', typeof msg, msg, E);
          // TODO: disconnect from peer
          console.warn('you should disconnect from this peer:', handle);
        }
      }

      const obj = message.toObject();
      const actor = new Actor(obj);

      let local = null;

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
          const now = Date.now();
          local = Message.fromVector(['Pong', now.toString()]);
          return server._sendTo(handle, local.toBuffer());
        case 'GenericMessage':
          local = Message.fromVector(['GenericMessage', JSON.stringify({
            type: 'GenericMessageReceipt',
            content: actor.id
          })]);

          let msg = null;

          try {
            msg = JSON.parse(obj.data);
          } catch (exception) {}

          if (msg) {
            server.emit('call', msg.data || {
              method: 'GenericMessage',
              params: [msg.data]
            });

            await server.handleFabricMessage(message);
          }

          break;
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
      const receipt = Message.fromVector(['P2P_MESSAGE_RECEIPT', {
        '@type': 'Receipt',
        '@actor': handle,
        '@data': message,
        '@version': 1
      }]);

      socket.send(receipt.toBuffer());
    });

    // set up an oracle, which listens to patches from server
    socket.oracle = server.on('patches', function (patches) {
      console.log('magic oracle patches:', patches);
    });

    // insert connection to library
    server.connections[player['@data'].connection] = socket;
    // server.players[player['@data'].connection] = player;

    const ack = Message.fromVector([P2P_SESSION_ACK, crypto.randomBytes(32).toString('hex')]);
    const raw = ack.toBuffer();
    socket.send(raw);

    // send result
    /* socket.send(JSON.stringify({
      '@type': 'VerAck',
      '@version': 1
    })); */

    if (this.app) {
      socket.send(JSON.stringify({
        '@type': 'Inventory',
        '@parent': server.app.id,
        '@version': 1
      }));

      socket.send(JSON.stringify({
        '@type': 'State',
        '@data': server.app.state,
        '@version': 1
      }));
    }

    return socket;
  }

  _sendTo (actor, msg) {
    const target = this.connections[actor];

    if (!target) throw new Error('No such target.');

    const result = target.send(msg);

    return {
      destination: actor,
      result: result
    };
  }

  // TODO: consolidate with Peer
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
    let html = '';

    if (this.app) {
      html = this.app.render(this.state);
    } else {
      html = '<fabric-application><fabric-card>Failed to load, as no application was available.</fabric-card></fabric-application>';
    }

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
    // TODO: double-check Apache spec
    const asApache = [
      `${req.hostname}:${this.settings.port}`,
      req.hostname,
      req.user,
      `"${req.method} ${req.path} HTTP/${req.httpVersion}"`,
      res.statusCode,
      res.getHeader('content-length')
    ].join(' ');

    this.emit('log', asApache);

    return next();
  }

  _headerMiddleware (req, res, next) {
    res.header('X-Powered-By', '@fabric/http');
    // TODO: only enable when requested
    // @ChronicSmoke
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Headers', 'content-type');
    return next();
  }

  _redirectMiddleware (req, res, next) {
    if (Object.keys(this.settings.redirects).includes(req.path)) {
      return res.redirect(this.settings.redirects[req.path]);
    } else {
      return next();
    }
  }

  _verifyClient (info, done) {
    this.emit('debug', `[HTTP:SERVER] _verifyClient ${info}`);

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
    this.emit('debug', `[HTTP:SERVER] Adding route: ${path}`);
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
    if (this.settings.verbosity >= 5) this.emit('debug', `[HTTP:SERVER] Handling routable request: ${req.method} ${req.path}`);
    const server = this;

    // Prepare variables
    let result = null;
    let route = null;
    let resource = null;

    for (let i in this.routes) {
      let local = this.routes[i];
      if (req.path.match(local.route)) {
        route = local;
        resource = local.resource;
        break;
      }
    }

    this.debug('Resource mounted:', resource);

    switch (req.method.toUpperCase()) {
      // Discard unhandled methods
      default:
        return next();
      case 'HEAD':
        let existing = await server._GET(req.path);
        if (!existing) return res.status(404).end();
        break;
      case 'GET':
        if (resource) {
          try {
            result = await server.stores[resource].get(req.path);
          } catch (exception) {
            console.warn('[HTTP:SERVER]', 'Warning:', exception);
          }
        }

        // TODO: re-optimize querying from memory (i.e., don't touch disk / restore)
        // If a result was found, use it by breaking immediately
        // if (result) break;

        // No result found, call _GET locally
        result = await server._GET(req.path);
        // let content = await server.stores[resource].get(req.path);
        break;
      case 'PUT':
        result = await server._PUT(req.path, req.body);
        break;
      case 'POST':
        if (resource) {
          result = await server.stores[resource].create(req.body);
        }

        if (!result) return res.status(500).end();

        // Call parent method (2 options)
        // Option 1 (original): Assigns the direct result
        // let link = await server._POST(req.path, result);
        // Option 2 (testing): Assigns the raw body
        let link = await server._POST(req.path, req.body);

        // POST requests return a 303 header with a pointer to the object
        return res.redirect(303, link);
      case 'PATCH':
        let patch = await server._PATCH(req.path, req.body);
        result = patch;
        break;
      case 'DELETE':
        await server._DELETE(req.path);
        return res.sendStatus(204);
      case 'OPTIONS':
        return res.send({
          '@type': 'Error',
          '@data': 'Not yet supported.'
        });
    }

    // If no result found, return 404
    if (!result) {
      return res.status(404).send({
        status: 'error',
        message: 'Document not found.',
        request: {
          method: req.method.toUpperCase(),
          path: req.path
        }
      });
    }

    console.debug('Preparing to format:', req.path);

    return res.format({
      json: function () {
        res.header('Content-Type', 'application/json');
        return res.send(result);
      },
      html: function () {
        let output = '';

        if (resource) {
          output = server.app._loadHTML(resource.render(result));
        } else {
          output = server.app.toHTML();
        }

        return res.send(server.app._renderWith(output));
      }
    });
  }

  async start () {
    console.debug('[HTTP:SERVER]', 'Starting...');
    this.emit('debug', '[HTTP:SERVER] Starting...');

    this.status = 'starting';

    /* if (!server.settings.resources || !Object.keys(server.settings.resources).length) {
      console.trace('[HTTP:SERVER]', 'No Resources have been defined for this server.  Please provide a "resources" map in the configuration.');
    } */

    /* const fields = {
      hello: {
        type: GraphQLString,
        resolve: () => 'world'
      }
    }; */

    // console.log('resources:', this.settings.resources);

    for (let name in this.settings.resources) {
      const definition = this.settings.resources[name];
      const resource = await this._defineResource(name, definition);

      // console.log('resource:', name, definition, resource);

      // Attach to GraphQL
      /* fields[resource.names[1].toLowerCase()] = {
        type: GraphQLObjectType,
        resolve: () => {}
      }; */

      if (this.settings.verbosity >= 6) console.log('[AUDIT]', 'Created resource:', resource);
    }

    // console.log('fields:', fields);
    /* this.graphQLSchema = new GraphQLSchema({
      query: new GraphQLObjectType({
        name: 'Query',
        fields: fields
      })
    }); */

    // Middlewares
    this.express.use(this._logMiddleware.bind(this));
    this.express.use(auth.bind(this));

    // Custom Headers
    this.express.use(this._headerMiddleware.bind(this));
    this.express.use(this._redirectMiddleware.bind(this));

    // TODO: defer to an in-memory datastore for requested files
    // NOTE: disable this line to compile on-the-fly
    this.express.use(express.static(this.settings.assets));
    this.express.use(extractor());
    this.express.use(this._roleMiddleware.bind(this));

    this.express.all('/services/graphql', graphql({ schema: this.graphQLSchema }))

    // configure sessions & parsers
    // TODO: migrate to {@link Session} or abolish entirely
    if (this.settings.sessions) {
      this.express.use(this.sessions);
      this.express.use(flasher());
    }

    // Other Middlewares
    this.express.use(parsers.urlencoded({ extended: true }));
    this.express.use(parsers.json());

    for (let name in this.settings.middlewares) {
      const middleware = this.settings.middlewares[name];
      this.express.use(middleware);
    }

    // TODO: render page
    this.express.options('/', this._handleOptionsRequest.bind(this));
    // TODO: enable this route by disabling or moving the static asset handler above
    // NOTE: see `this.express.use(express.static('assets'));`
    this.express.get('/', this._handleIndexRequest.bind(this));

    // handle custom routes.
    // TODO: abolish this garbage in favor of resources.
    for (let i = 0; i < this.customRoutes.length; i++) {
      const route = this.customRoutes[i];
      switch (route.method.toLowerCase()) {
        case 'get':
        case 'put':
        case 'post':
        case 'patch':
        case 'delete':
        case 'search':
        case 'options':
          this.express[route.method.toLowerCase()](route.path, route.handler);
          break;
      }
    }

    // Attach the internal router
    this.express.get('/*', this._handleRoutableRequest.bind(this));
    this.express.put('/*', this._handleRoutableRequest.bind(this));
    this.express.post('/*', this._handleRoutableRequest.bind(this));
    this.express.patch('/*', this._handleRoutableRequest.bind(this));
    this.express.delete('/*', this._handleRoutableRequest.bind(this));
    this.express.options('/*', this._handleRoutableRequest.bind(this));

    // create the HTTP server
    // NOTE: stoppable is used here to force immediate termination of
    // all connections.  We may want to defer to default APIs for portability reasons.
    this.http = stoppable(http.createServer(this.express), 0);

    // attach a WebSocket handler
    this.wss = new WebSocket.Server({
      server: this.http,
      // TODO: validate entire verification chain
      // verifyClient: this._verifyClient.bind(this)
    });

    // set up the WebSocket connection handler
    this.wss.on('connection', this._handleWebSocket.bind(this));

    this.agent.on('debug', (msg) => {
      console.debug('debug:', msg);
    });

    this.agent.on('log', (msg) => {
      console.log('log:', msg);
    });

    // Handle messages from internal app
    if (this.app) {
      this.app.on('snapshot', this._handleAppMessage.bind(this));
      this.app.on('message', this._handleAppMessage.bind(this));
      this.app.on('commit', this._handleAppMessage.bind(this));
    }

    // Handle internal call requests
    this.on('call', this._handleCall.bind(this));

    // TODO: convert to bound functions
    this.on('commit', async function (msg) {
      console.log('[HTTP:SERVER]', 'Internal commit:', msg);
    });

    this.on('debug', this.debug.bind(this));
    this.on('log', this.log.bind(this));
    this.on('warning', this.warn.bind(this));
    this.on('message', async function (msg) {
      console.log('[HTTP:SERVER]', 'Internal message:', msg);
    });

    this._registerMethod('GenericMessage', (msg) => {
      // console.log('GENERIC:', msg);
    });

    await this.agent.start();

    if (this.app) {
      try {
        await this.app.start();
      } catch (E) {
        console.error('Could not start this app:', E);
      }
    }

    if (this.settings.listen) {
      this.http.on('listening', notifyReady);
      await this.http.listen(this.settings.port, this.interface);
    } else {
      console.warn('[HTTP:SERVER]', 'Listening is disabled.  Only events will be emitted!');
      notifyReady();
    }

    function notifyReady () {
      this.status = 'STARTED';
      this.emit('ready', {
        id: this.id
      });
    }

    // commit to our results
    // await this.commit();

    this.emit('warning', '[WARNING] Unencrypted transport!  You should consider changing the `host` property in your config, or set up a TLS server to encrypt traffic to and from this node.');
    this.emit('log', `[HTTP:SERVER] Started!  Link: ${this.link}`);

    return this;
  }

  async flush () {
    this.emit('debug', `Flush requested for keys: ${this.keys}`);

    for (let item of this.keys) {
      // console.log('...flushing:', item);
      try {
        await this._DELETE(item);
      } catch (E) {
        console.error(E);
      }
    }
  }

  async stop () {
    if (this.settings.verbosity >= 4) console.log('[HTTP:SERVER]', 'Stopping...');
    const server = this;
    this.status = 'stopping';

    try {
      await server.http.stop();
    } catch (E) {
      console.error('Could not stop HTTP listener:', E);
    }

    await this.agent.stop();

    if (server.app) {
      try {
        await server.app.stop();
      } catch (E) {
        console.error('Could not stop server app:', E);
      }
    }

    this.status = 'stopped';
    server.emit('stopped');

    if (this.settings.verbosity >= 4) console.log('[HTTP:SERVER]', 'Stopped!');
    return server;
  }

  async _GET (path) {
    if (!this.app || !this.app.store) return null;
    if (this.settings.verbosity >= 4) console.log('[HTTP:SERVER]', 'Handling GET to', path);
    let result = await this.app.store._GET(path);
    if (this.settings.verbosity >= 5) console.log('[HTTP:SERVER]', 'Retrieved:', result);
    if (!result && this.collections.includes(path)) result = [];
    return result;
  }

  async _PUT (path, data) {
    if (!this.app || !this.app.store) return null;
    if (this.settings.verbosity >= 4) console.log('[HTTP:SERVER]', 'Handling PUT to', path, data);
    return this.app.store._PUT(path, data);
  }

  async _POST (path, data) {
    if (this.settings.verbosity >= 4) console.trace('[HTTP:SERVER]', 'Handling POST to', path, data);
    return this.app.store._POST(path, data);
  }

  async _PATCH (path, data) {
    if (!this.app || !this.app.store) return null;
    if (this.settings.verbosity >= 4) console.log('[HTTP:SERVER]', 'Handling PATCH to', path, data);
    return this.app.store._PATCH(path, data);
  }

  async _DELETE (path) {
    if (this.settings.verbosity >= 4) console.log('[HTTP:SERVER]', 'Handling DELETE to', path);
    return this.app.store._DELETE(path);
  }
}

module.exports = FabricHTTPServer;
