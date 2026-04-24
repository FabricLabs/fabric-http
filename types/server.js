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
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const merge = require('lodash.merge');
const pluralize = require('pluralize');

// TODO: remove Express entirely...
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
const Collection = require('@fabric/core/types/collection');
const Key = require('@fabric/core/types/key');
// const Resource = require('@fabric/core/types/resource');
const Service = require('@fabric/core/types/service');
const Message = require('@fabric/core/types/message');
const Entity = require('@fabric/core/types/entity');
const State = require('@fabric/core/types/state');
const Peer = require('@fabric/core/types/peer');

// Internal Types
const auth = require('../middlewares/auth');
const payments = require('../middlewares/payments');

// Internal Components
// const App = require('./app');
// const Client = require('./client');
// const Component = require('./component');
// const Browser = require('./browser');
const SPA = require('./spa');

// Dependencies
const WebSocket = require('ws');
const { acceptFirstHtmlNavigation } = require('./acceptNegotiation');

/**
 * Resolve `relativeCandidate` under `staticRoot` and reject `..` / absolute escape attempts.
 * @param {string} relativeCandidate
 * @param {string} staticRoot
 * @returns {string|null} Absolute path, or null if unsafe / invalid.
 */
function resolvedPathUnderStaticRoot (relativeCandidate, staticRoot) {
  if (relativeCandidate == null) return null;
  const s = path.basename(String(relativeCandidate)).trim();
  if (!s || s.includes('\0')) return null;
  if (!/^[a-zA-Z0-9._-]{1,128}$/.test(s)) return null;
  const root = String(staticRoot || '').trim();
  if (!root) return null;
  // s is a single vetted path segment; avoid path.join so security scanners do not treat s as tainted for join/resolve.
  const normRoot = path.normalize(root);
  const full = normRoot.endsWith(path.sep) ? normRoot + s : normRoot + path.sep + s;
  const rel = path.relative(normRoot, full);
  if (rel.startsWith('..') || path.isAbsolute(rel)) return null;
  return full;
}

function safeFileComponent (input, fallback) {
  const candidate = path.basename(String(input || '')).trim();
  if (!candidate) return fallback;
  if (!/^[a-zA-Z0-9._-]{1,128}$/.test(candidate)) return fallback;
  return candidate;
}

function xmlEscape (value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * This package’s `assets/` directory (Fomantic / semantic, etc.). Serves as the second `express.static`
 * mount so downstream apps that set `path` to their own `assets/` can override; missing paths fall through here.
 * @returns {string|null}
 */
function fabricHttpPackageAssetsDir () {
  try {
    // This file is `types/server.js`; package root is its parent (no `..` / no tainted resolve).
    const pkgRoot = path.dirname(__dirname);
    const out = pkgRoot + path.sep + 'assets';
    const rel = path.relative(pkgRoot, out);
    if (rel.startsWith('..') || path.isAbsolute(rel) || rel !== 'assets') return null;
    // Do not fs.* on out (Codacy/Semgrep flags non-literal paths). express.static tolerates a missing dir.
    return out;
  } catch (err) {
    return null;
  }
}

/**
 * `express.send` can label theme fonts as `application/octet-stream`. With `X-Content-Type-Options: nosniff`
 * (set by @fabric/hub) Chromium/Electron may refuse to load @font-face resources; set explicit font MIME
 * types for common Fomantic (Semantic) theme files under /themes/…/assets/fonts/
 * @param {import('http').ServerResponse} res
 * @param {string} filePath
 */
function fabricHttpStaticSetHeaders (res, filePath) {
  if (!filePath) return;
  const ext = (path.extname(String(filePath)) || '').toLowerCase();
  if (ext === '.woff2') {
    res.setHeader('Content-Type', 'font/woff2');
  } else if (ext === '.woff') {
    res.setHeader('Content-Type', 'font/woff');
  } else if (ext === '.ttf') {
    res.setHeader('Content-Type', 'font/ttf');
  } else if (ext === '.eot') {
    res.setHeader('Content-Type', 'application/vnd.ms-fontobject');
  } else if (ext === '.otf') {
    res.setHeader('Content-Type', 'font/otf');
  } else if (ext === '.svg' && /[/\\]fonts[/\\]/.test(String(filePath))) {
    res.setHeader('Content-Type', 'image/svg+xml; charset=utf-8');
  }
}

/**
 * @param {import('http').ServerResponse} res
 * @param {string} filePath
 * @param {((res: import('http').ServerResponse, p: string) => void) | null | undefined} [user]
 */
function mergeStaticSetHeaders (res, filePath, user) {
  if (typeof user === 'function') {
    try {
      user(res, filePath);
    } catch (_) { /* app hook should not take down static */ }
  }
  fabricHttpStaticSetHeaders(res, filePath);
}

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
      key: null,
      path: './stores/server',
      port: HTTP_SERVER_PORT,
      listen: true,
      accessLog: 'access.log',
      resources: {},
      components: {},
      middlewares: {},
      redirects: {},
      routes: [],
      services: {
        audio: {
          address: '/devices/audio'
        }
      },
      seed: crypto.randomBytes(32).toString('hex'),
      sessions: false,
      state: {
        status: 'PAUSED'
      },
      websocket: {
        requireClientToken: false,
        clientToken: null
      },
      /** POST JSON-RPC over HTTP; same methods as WebSocket `JSONCall` when enabled. */
      jsonRpc: {
        enabled: false,
        // Canonical RPC endpoint for Fabric clients.
        paths: ['/services/rpc'],
        /** When true, HTTP JSON-RPC requires a verified bearer token (`request.authenticated`). */
        requireAuth: true
      },
      /** Passed to `express.static` (see `start()`). */
      static: {
        cacheSeconds: 0,
        dotfiles: 'ignore',
        etag: true,
        index: ['index.html'],
        fallthrough: true,
        immutable: false
      },
      spaFallback: false,
      spaFallbackExclude: null,
      spaFallbackIndex: 'index.html',
      /** When true, send `Access-Control-Allow-*` for browser clients. */
      cors: true,
      /** When true, use `compression` middleware if the package is installed. */
      compression: true,
      /** Sitemap generation settings for `/sitemap.xml`. */
      sitemap: {
        enabled: true,
        path: '/sitemap.xml',
        protocol: 'http',
        includeRoot: true,
        includeStaticIndex: true,
        includeCustomRoutes: true,
        includeResourceRoutes: true,
        includeJsonRpc: false,
        includeParameterized: false,
        urls: []
      },
      /**
       * HTTP 402 Payment Required — used only when routes mount `middlewares/payments`
       * and `enabled` is true (see `/services/test` when `exposePaymentTestRoute` is true).
       */
      payments: {
        enabled: false,
        amount: 0.01,
        currency: 'BTC',
        description: 'Fabric access',
        detail: 'Complete payment to continue.',
        /** When true and `payments.enabled`, `GET /services/test` runs the payment wall before the demo body. */
        exposePaymentTestRoute: true
      },
      /** JSON-RPC `RegisterWebRTCPeer` / `ListWebRTCPeers` / `UnregisterWebRTCPeer` limits. */
      webrtc: {
        maxPeers: 256,
        idMaxLen: 128,
        labelMaxLen: 256,
        metaMaxJsonBytes: 16384
      }
    }, settings);

    this.settings.assets = settings.assets || settings.path || this.settings.assets || 'assets';

    this._rootKey = new Key(this.settings.key);

    this.connections = {};
    this.definitions = {};
    this.methods = {};
    this.stores = {};
    this.subscriptions = new Map(); // Track subscriptions by path

    // ## Fabric Agent
    // Establishes network connectivity with Fabric.  Manages peers, connections, and messages.
    this.agent = new Peer({
      listen: false,
      networking: true,
      peers: this.settings.peers,
      state: this.settings.state,
      upnp: false,
      xpub: this._rootKey.xpub
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
    this.accessLogStream = null;

    // Setup for Express application
    this.express = express();
    // TODO: enable cross-shard sessions
    this.sessions = session({
      resave: true,
      saveUninitialized: false,
      secret: this.settings.seed
    });

    // Local State Setup
    this._state = {
      actors: {},
      content: this.settings.state,
      history: [],
      messages: []
    };

    this.observer = monitor.observe(this.state);

    // Browser WebRTC peers (native RTCPeerConnection + WebSocket signaling from Hub).
    // The legacy npm `peer` ExpressPeerServer (PeerJS) was removed; register via Hub RPC / Bridge.
    this.webrtcPeers = new Map();
    /** @type {Map<string, string>} peer id → unregister secret (from last successful Register) */
    this.webrtcPeerSecrets = new Map();

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

  /**
   * Get a list of WebRTC peers registered with this server (see Hub `RegisterWebRTCPeer`).
   * @returns {Array} Array of WebRTC peer objects
   */
  get webrtcPeerList () {
    return Array.from(this.webrtcPeers.values());
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
    // TODO: migrate to Message instances throughout; buffer only transparently when sending to peers
    // Peer.broadcast expects a Buffer, not a Message instance
    // TODO: is that true?  Message instances seem to be the correct type...
    if (message && typeof message.toBuffer === 'function') {
      await this.agent.broadcast(message.toBuffer());
    } else if (Buffer.isBuffer(message)) {
      await this.agent.broadcast(message);
    } else {
      console.error('[SERVER]', 'Invalid message type passed to handleFabricMessage:', typeof message);
    }
  }

  broadcast (message) {
    let buf = null;
    if (Buffer.isBuffer(message)) {
      buf = message;
    } else if (message && typeof message.toBuffer === 'function') {
      buf = message.toBuffer();
    }
    if (!buf) {
      console.error('[SERVER] broadcast: expected Buffer or Message with toBuffer(), got:', typeof message);
      return;
    }

    const peers = Object.keys(this.connections);

    for (let i = 0; i < peers.length; i++) {
      const peer = peers[i];

      if (peer.status === 'connected') {
        // TODO: move send buffer here
      }

      try {
        this.connections[peer].send(buf);
      } catch (E) {
        console.error('Could not send message to peer:', E);
      }
    }
  }

  /**
   * Same authorization inputs as HTTP POST JSON-RPC: verified bearer (`req.authenticated`),
   * raw `Bearer` on the upgrade/request, or websocket client-token channels.
   * WebSocket handshake may also use `settings.websocket` client token (query / Bearer / Sec-WebSocket-Protocol).
   * @param {Object} req Node.js `IncomingMessage` (HTTP upgrade or Express `req`).
   * @returns {boolean}
   */
  _isJsonRpcTransportAuthorized (req) {
    if (!req) return false;
    let rpcAuthenticated = req.authenticated === true;
    if (!rpcAuthenticated && !req.token && req.headers && typeof req.headers.authorization === 'string') {
      const h = req.headers.authorization;
      if (h.startsWith('Bearer ')) req.token = h.slice(7).trim();
    }
    if (!rpcAuthenticated && req.token) {
      const secret = this.settings.tokenSecret || this.settings.seed;
      const verification = auth.verifyBearerToken(req.token, secret);
      rpcAuthenticated = verification.valid === true;
    }
    // Do not treat "websocket client token not configured" as JSON-RPC authorization:
    // `_verifyWebSocketClient` returns true when `requireClientToken` is off, which would
    // leave JSON-RPC open to any peer that can open a socket when `jsonRpc.requireAuth` is on.
    if (!rpcAuthenticated) {
      const wsCfg = this.settings.websocket || {};
      const wsSecret = wsCfg.clientToken || wsCfg.sharedSecret || null;
      const wsRequired = wsCfg.requireClientToken === true || wsCfg.requireClientToken === '1' || wsCfg.requireClientToken === 1;
      if (wsRequired && wsSecret) {
        rpcAuthenticated = this._verifyWebSocketClient({ req });
      }
    }
    return !!rpcAuthenticated;
  }

  _verifyWebSocketClient (info) {
    const wsCfg = this.settings.websocket || {};
    const secret = wsCfg.clientToken || wsCfg.sharedSecret || null;
    const required = wsCfg.requireClientToken === true || wsCfg.requireClientToken === '1' || wsCfg.requireClientToken === 1;
    if (!required) return true;
    if (!secret) {
      if ((this.settings.verbosity || 0) >= 2) {
        console.warn('[SERVER] WebSocket handshake rejected: requireClientToken is set but neither websocket.clientToken nor websocket.sharedSecret is configured');
      }
      return false;
    }

    const req = info.req;
    let token = null;
    try {
      const rawUrl = req.url || '/';
      const u = new URL(rawUrl, 'http://localhost');
      token = u.searchParams.get('token') || u.searchParams.get('clientToken');
    } catch (e) {}

    const auth = req.headers && req.headers.authorization;
    if (!token && auth && typeof auth === 'string' && auth.startsWith('Bearer ')) {
      token = auth.slice(7).trim();
    }

    if (!token && req.headers && req.headers['sec-websocket-protocol']) {
      const protos = String(req.headers['sec-websocket-protocol']).split(',').map((s) => s.trim());
      for (let i = 0; i < protos.length; i++) {
        const p = protos[i];
        if (p.startsWith('fabric.token.')) {
          token = decodeURIComponent(p.slice('fabric.token.'.length));
          break;
        }
      }
    }

    const tokenDigest = crypto.createHash('sha256').update(String(token || '')).digest();
    const secretDigest = crypto.createHash('sha256').update(String(secret || '')).digest();
    const ok = crypto.timingSafeEqual(tokenDigest, secretDigest);
    if (!ok && (this.settings.verbosity || 0) >= 3) {
      console.warn('[SERVER] WebSocket handshake rejected: missing or invalid client token');
    }
    return ok;
  }

  debug (content) {
    if ((this.settings.verbosity || 0) < 4) return;
    console.debug('[FABRIC:EDGE]', (new Date().toISOString()), content);
  }

  log (content) {
    if ((this.settings.verbosity || 0) < 3) return;
    console.log('[FABRIC:EDGE]', (new Date().toISOString()), content);
  }

  trust (source) {
    super.trust(source);

    source.on('message', function (msg) {
      console.log('[HTTP:SERVER]', 'trusted source:', source.constructor.name, 'sent message:', msg);
    });
  }

  warn (content) {
    if ((this.settings.verbosity || 0) < 2) return;
    console.warn('[FABRIC:EDGE]', (new Date().toISOString()), content);
  }

  _addAllRoutes () {
    for (let i = 0; i < this.settings.routes.length; i++) {
      const route = this.settings.routes[i];

      // Validate route before adding
      if (!route || !route.method || typeof route.method !== 'string') {
        console.warn('[HTTP:SERVER]', 'Skipping invalid route in settings.routes:', route);
        continue;
      }

      // Support both 'route' and 'path' keys
      const path = route.route || route.path;
      if (!path || !route.handler) {
        console.warn('[HTTP:SERVER]', 'Skipping route with missing path or handler:', route);
        continue;
      }

      this._addRoute(route.method, path, route.handler);
    }

    return this;
  }

  _registerBitcoin (bitcoin) {
    this.bitcoin = bitcoin;
    return this;
  }

  _registerMethod (name, method) {
    this.methods[name] = method.bind(this);
  }

  /**
   * @returns {{ maxPeers: number, idMaxLen: number, labelMaxLen: number, metaMaxJsonBytes: number }}
   */
  _getWebRtcLimits () {
    const w = this.settings.webrtc || {};
    const maxPeers = Number(w.maxPeers);
    const idMax = Number(w.idMaxLen);
    const labelMax = Number(w.labelMaxLen);
    const metaMax = Number(w.metaMaxJsonBytes);
    return {
      maxPeers: Number.isFinite(maxPeers) && maxPeers > 0 ? Math.min(maxPeers, 100000) : 256,
      idMaxLen: Number.isFinite(idMax) && idMax > 0 ? Math.min(idMax, 512) : 128,
      labelMaxLen: Number.isFinite(labelMax) && labelMax >= 0 ? Math.min(labelMax, 1024) : 256,
      metaMaxJsonBytes: Number.isFinite(metaMax) && metaMax > 0 ? Math.min(metaMax, 1048576) : 16384
    };
  }

  _assertWebRtcPeerId (raw, maxLen) {
    if (raw == null || raw === '') throw new Error('RegisterWebRTCPeer: missing id (or peerId)');
    const id = String(raw).trim();
    if (!id || id.length > maxLen) {
      throw new Error(`RegisterWebRTCPeer: id length 1..${maxLen} required`);
    }
    for (let i = 0; i < id.length; i++) {
      const c = id.charCodeAt(i);
      if (c < 32 || c === 127) throw new Error('RegisterWebRTCPeer: id contains control characters');
    }
    return id;
  }

  _assertWebRtcUnregisterId (raw, maxLen) {
    if (raw == null || raw === '') throw new Error('UnregisterWebRTCPeer: missing id (or peerId)');
    const id = String(raw).trim();
    if (!id || id.length > maxLen) {
      throw new Error(`UnregisterWebRTCPeer: id length 1..${maxLen} required`);
    }
    for (let i = 0; i < id.length; i++) {
      const c = id.charCodeAt(i);
      if (c < 32 || c === 127) throw new Error('UnregisterWebRTCPeer: id contains control characters');
    }
    return id;
  }

  _normalizeWebRtcLabel (raw, maxLen) {
    if (raw == null || raw === '') return null;
    let s = String(raw);
    if (s.length > maxLen) s = s.slice(0, maxLen);
    return s;
  }

  /**
   * @param {unknown} raw
   * @param {number} maxBytes
   * @returns {Object|null} Clone via JSON round-trip
   */
  _normalizeWebRtcMeta (raw, maxBytes) {
    if (raw == null || raw === undefined) return null;
    if (typeof raw !== 'object' || Array.isArray(raw)) {
      throw new Error('RegisterWebRTCPeer: meta / metadata must be a plain object or omitted');
    }
    const proto = Object.getPrototypeOf(raw);
    if (proto !== null && proto !== Object.prototype) {
      throw new Error('RegisterWebRTCPeer: meta / metadata must be a plain object or omitted');
    }
    const j = JSON.stringify(raw);
    if (j.length > maxBytes) {
      throw new Error('RegisterWebRTCPeer: meta / metadata JSON exceeds size limit');
    }
    return /** @type {Object} */ (JSON.parse(j));
  }

  _timingEqualUtf8 (a, b) {
    if (a == null || b == null) return false;
    const ab = Buffer.from(String(a), 'utf8');
    const bb = Buffer.from(String(b), 'utf8');
    if (ab.length !== bb.length) return false;
    return crypto.timingSafeEqual(ab, bb);
  }

  _rpcRegisterWebRtcPeer (reg) {
    const peer = reg && typeof reg === 'object' ? reg : {};
    const limits = this._getWebRtcLimits();
    const id = this._assertWebRtcPeerId(peer.id || peer.peerId, limits.idMaxLen);
    if (this.webrtcPeers.size >= limits.maxPeers && !this.webrtcPeers.has(id)) {
      throw new Error('RegisterWebRTCPeer: peer registry full');
    }
    const label = this._normalizeWebRtcLabel(peer.label, limits.labelMaxLen);
    const meta = this._normalizeWebRtcMeta(
      peer.meta !== undefined ? peer.meta : peer.metadata,
      limits.metaMaxJsonBytes
    );
    const secret = crypto.randomBytes(24).toString('hex');
    this.webrtcPeerSecrets.set(id, secret);
    this.webrtcPeers.set(id, {
      id,
      label,
      meta,
      registeredAt: Date.now()
    });
    return { ok: true, id, total: this.webrtcPeers.size, secret };
  }

  _rpcUnregisterWebRtcPeer (reg) {
    const peer = reg && typeof reg === 'object' ? reg : {};
    const limits = this._getWebRtcLimits();
    const id = this._assertWebRtcUnregisterId(peer.id || peer.peerId, limits.idMaxLen);
    const secret = peer.secret != null ? String(peer.secret).trim() : '';
    if (!secret) {
      throw new Error('UnregisterWebRTCPeer: secret is required (value returned from RegisterWebRTCPeer)');
    }
    const expected = this.webrtcPeerSecrets.get(id);
    if (!expected || !this._timingEqualUtf8(secret, expected)) {
      throw new Error('UnregisterWebRTCPeer: invalid secret or unknown id');
    }
    this.webrtcPeerSecrets.delete(id);
    const ok = this.webrtcPeers.delete(id);
    return { ok, id, total: this.webrtcPeers.size };
  }

  _rpcListWebRtcPeers () {
    return { ok: true, peers: Array.from(this.webrtcPeers.values()) };
  }

  _handleAppMessage (msg) {
    console.trace('[HTTP:SERVER]', 'Internal app emitted message:', msg);
  }

  _handleCall (call) {
    if (!call || !call.method) throw new Error('Call requires "method" parameter.');
    let params = call.params;
    if (params === undefined || params === null) params = [];
    if (!Array.isArray(params)) params = [params];
    if (!this.methods[call.method]) throw new Error(`Method "${call.method}" has not been registered.`);
    return this.methods[call.method].apply(this, params);
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

    // Initialize socket subscriptions
    socket.subscriptions = new Set();

    socket._resetKeepAlive = function () {
      clearInterval(socket._heartbeat);
      socket._heartbeat = setInterval(function () {
        const now = Date.now();
        const ping = Message.fromVector(['Ping', now.toString()]);

        // Sign the ping message before sending
        if (server._rootKey && server._rootKey.private) {
          ping.signWithKey(server._rootKey);
        }

        try {
          server._sendTo(handle, ping.toBuffer());
        } catch (exception) {
          console.error('could not ping peer:', handle, exception);
        }
      }, WEBSOCKET_KEEPALIVE);
    };

    socket._timeout = null;
    socket._resetKeepAlive();

    const jsonRpcCfg = this.settings.jsonRpc || {};
    // Align WS JSONCall with HTTP JSON-RPC: enforce transport auth only when HTTP JSON-RPC
    // is enabled and `requireAuth` is on. Otherwise leave JSONCall behavior unchanged for
    // servers that use WebSocket calls without registering POST `/services/rpc`.
    socket._fabricJsonRpcTransportAuthorized = (jsonRpcCfg.enabled === true && jsonRpcCfg.requireAuth === true)
      ? this._isJsonRpcTransportAuthorized(request)
      : true;

    // Clean up memory when the connection has been safely closed (ideal case).
    socket.on('close', function () {
      clearInterval(socket._heartbeat);
      // Clear subscriptions for this socket
      socket.subscriptions.clear();
      delete server.connections[player['@data'].connection];
    });

    // TODO: message handler on base class
    socket.on('message', async (msg) => {
      let message = null;
      let type = null;

      try {
        // Handle binary messages
        if (msg instanceof Buffer) {
          message = Message.fromBuffer(msg);
        } else if (msg.data instanceof Buffer) {
          message = Message.fromBuffer(msg.data);
        } else {
          // Try to parse as JSON if not binary
          const data = typeof msg === 'string' ? msg : msg.toString('utf8');
          const parsed = JSON.parse(data);
          // Extract type from parsed JSON if available (support both @type and type)
          if (parsed && (parsed.type || parsed['@type'])) {
            type = parsed.type || parsed['@type'];
          }
          // If it's a JSON object, create message from object, otherwise try fromRaw
          if (parsed && typeof parsed === 'object' && !Buffer.isBuffer(parsed)) {
            message = new Message(parsed);
          } else {
            message = Message.fromRaw(parsed);
          }
        }

        if (!message) {
          console.error('Could not parse message:', msg);
          return;
        }

        // Use extracted type or fall back to message.type
        const messageType = type || message.type;

        // System messages (HEARTBEAT, Ping, Pong) may not have signatures.
        // `message.type` from `fromBuffer` is wire form (e.g. P2P_PING); parsed JSON may use friendly names.
        const systemMessageTypes = ['HEARTBEAT', 'Ping', 'Pong', 'P2P_PING', 'P2P_PONG'];
        if (!message.raw.signature.toString() && !systemMessageTypes.includes(messageType)) {
          let headerForLog;
          try {
            headerForLog = message.header;
          } catch (headerErr) {
            headerForLog = `(header: ${headerErr.message})`;
          }
          console.trace('[SERVER]', 'Message has no signature:', message, headerForLog, message.body);
        }
        // if (!message.verify()) console.warn('[SERVER]', 'Message signature verification failed:', message);

        const obj = message.toObject();
        const actor = new Actor(obj);

        let local = null;
        const switchType = messageType || message.type;

        // Use extracted messageType for switch statement
        switch (switchType) {
          case 'HEARTBEAT':
            // HEARTBEAT messages are keepalive signals, no action needed
            if (server.settings.debug) console.debug('[SERVER]', 'Received HEARTBEAT from:', handle);
            break;
          case 'JSONCall':
          case 'JSON_CALL':
            // console.trace('[SERVER]', 'received JSON call:', message.body);
            try {
              const jsonCallPayload = JSON.parse(message.body);
              const preimage = crypto.createHash('sha256').update(message.body).digest('hex');
              const hash = crypto.createHash('sha256').update(preimage).digest('hex');

              if (!socket._fabricJsonRpcTransportAuthorized) {
                const errBody = JSON.stringify({
                  method: 'JSONCallResult',
                  params: [hash, null],
                  error: {
                    code: -32001,
                    message: 'Unauthorized: valid bearer or client token required for JSON-RPC (same policy as POST /services/rpc)'
                  }
                });
                const denied = Message.fromVector(['JSONCall', errBody]);
                if (server._rootKey && server._rootKey.private) denied.signWithKey(server._rootKey);
                socket.send(denied.toBuffer());
                break;
              }

              const kernel = new Actor(jsonCallPayload);
              const result = await server._handleCall({
                hash: hash,
                method: jsonCallPayload.method,
                params: jsonCallPayload.params
              });

              if (server.settings.debug) {
                console.debug('[SERVER]', 'JSONCall completed:', jsonCallPayload.method);
              }

              this.commit();

              const callResultMessage = Message.fromVector(['JSONCall', JSON.stringify({
                method: 'JSONCallResult',
                params: [hash, result]
              })]).signWithKey(this._rootKey);

              socket.send(callResultMessage.toBuffer());
            } catch (exception) {
              console.error('[SERVER]', 'Could not parse JSON blob:', exception);
              return;
            }
            break;
          case 'GET':
            {
              const answer = await server._GET(message['@data']['path']);
              console.log('answer:', answer);
              return answer;
            }
          case 'POST':
            {
              const link = await server._POST(message['@data']['path'], message['@data']['value']);
              console.log('[SERVER]', 'posted link:', link);
              break;
            }
          case 'PATCH':
            {
              const result = await server._PATCH(message['@data']['path'], message['@data']['value']);
              console.log('[SERVER]', 'patched:', result);
              break;
            }
          case 'Ping':
          case 'P2P_PING':
            {
              const now = Date.now();
              local = Message.fromVector(['Pong', now.toString()]);
              if (server._rootKey && server._rootKey.private) local.signWithKey(server._rootKey);
              let sendResult = null;
              try {
                sendResult = server._sendTo(handle, local.toBuffer());
              } catch (exception) {
                console.error('[FABRIC:EDGE]', '[SERVER]', 'Could not send Pong:', exception);
              }
              return sendResult;
            }
          case 'GenericMessage':
            {
              local = Message.fromVector(['GenericMessage', JSON.stringify({
                type: 'GenericMessageReceipt',
                content: actor.id
              })]);

              if (server._rootKey && server._rootKey.private) local.signWithKey(server._rootKey);
              let msgData = null;

              try {
                msgData = JSON.parse(obj.data);
              } catch (exception) {}

              if (msgData) {
                server.emit('call', msgData.data || {
                  method: 'GenericMessage',
                  params: [msgData.data]
                });

                await server.handleFabricMessage(message);
              }
              break;
            }
          case 'Pong':
          case 'P2P_PONG':
            {
              socket._resetKeepAlive();
              return;
            }
          case 'Call':
            {
              server.emit('call', {
                method: message['@data'].data.method,
                params: message['@data'].data.params
              });
              break;
            }
          case 'SUBSCRIBE':
            {
              const subscribePath = message['@data'];
              socket.subscriptions.add(subscribePath);
              if (server.settings.debug) console.debug('[SERVER]', 'Added subscription:', handle, 'to path:', subscribePath);
              break;
            }
          case 'UNSUBSCRIBE':
            {
              const unsubscribePath = message['@data'];
              socket.subscriptions.delete(unsubscribePath);
              if (server.settings.debug) console.debug('[SERVER]', 'Removed subscription:', handle, 'from path:', unsubscribePath);
              break;
            }
          default:
            if (server.settings.debug) {
              console.debug('[SERVER]', 'WebSocket message type not handled in switch:', messageType || message.type);
            }
            break;
        }

        // Skip receipt for keepalive/system message types.
        if (systemMessageTypes.includes(switchType)) return;

        // Send receipt of acknowledgement
        const receipt = Message.fromVector(['P2P_MESSAGE_RECEIPT', {
          '@type': 'Receipt',
          '@actor': handle,
          '@data': message,
          '@version': 1
        }]);

        if (server._rootKey && server._rootKey.private) receipt.signWithKey(server._rootKey);
        socket.send(receipt.toBuffer());
      } catch (error) {
        console.debug('[SERVER]', 'Error handling message:', error);
        socket.close(1002);
      }
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
    // socket.send(raw);

    // send result
    /* socket.send(JSON.stringify({
      '@type': 'VerAck',
      '@version': 1
    })); */

    if (this.app) {
      const inventory = Message.fromVector(['InventoryRequest', { parent: server.app.id, version: 0 }]);
      const state = Message.fromVector(['State', { content: server.app.state }]);
      // socket.send(inventory.toBuffer());
      // socket.send(state.toBuffer());
    }

    return socket;
  }

  _sendTo (actor, msg) {
    // Ensure only Fabric Message buffers are sent
    let payload = msg;

    if (!Buffer.isBuffer(msg)) {
      const message = Message.fromVector(['GenericMessage', JSON.stringify(msg)]);
      if (this._rootKey && this._rootKey.private) message.signWithKey(this._rootKey);
      payload = message.toBuffer();
    }

    const target = this.connections[actor];
    if (!target) throw new Error('No such target.');
    const result = target.send(payload);
    return {
      destination: actor,
      result: result
    };
  }

  // TODO: consolidate with Peer
  _relayFrom (actor, msg) {
    // Ensure only Fabric Message buffers are sent
    let payload = msg;

    if (!Buffer.isBuffer(msg)) {
      const message = Message.fromVector(['GenericMessage', JSON.stringify(msg)]);
      if (this._rootKey && this._rootKey.private) message.signWithKey(this._rootKey);
      payload = message.toBuffer();
    }

    let peers = Object.keys(this.connections).filter(key => {
      return key !== actor;
    });

    this.log(`relaying message from ${actor} to peers:`, peers);

    for (let i = 0; i < peers.length; i++) {
      try {
        this.connections[peers[i]].send(payload);
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

  /**
   * In-memory HTML shell for dual JSON/HTML routes. Set with {@link FabricHTTPServer#setApplicationHtml} or
   * `settings.applicationString` from the app constructor.
   * @returns {string}
   */
  getApplicationHtml () {
    if (typeof this._applicationHtml === 'string' && this._applicationHtml.length) {
      return this._applicationHtml;
    }
    const s = this.settings && this.settings.applicationString;
    return typeof s === 'string' ? s : '';
  }

  /**
   * @param {string} html - full document for `text/html` in {@link FabricHTTPServer#jsonOrShell} and
   *   {@link FabricHTTPServer#serveSpaShellIfHtmlNavigation}.
   */
  setApplicationHtml (html) {
    this._applicationHtml = typeof html === 'string' ? html : '';
  }

  /**
   * JSON for API clients, HTML application shell for `Accept: text/html` (e.g. SPA deep-link refresh on JSON routes).
   * @param {import('http').IncomingMessage} req
   * @param {import('http').ServerResponse} res
   * @param {() => Promise<void>} onJSON
   */
  jsonOrShell (req, res, onJSON) {
    const html = this.getApplicationHtml();
    const body = typeof html === 'string' && html
      ? html
      : '<!DOCTYPE html><html><body><p>Application shell not configured.</p></body></html>';
    return res.format({
      html: () => {
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.send(body);
      },
      json: async () => {
        try {
          await onJSON();
        } catch (error) {
          res.status(500).json({
            status: 'error',
            message: error && error.message ? error.message : String(error)
          });
        }
      }
    });
  }

  /**
   * Always JSON (no `Accept` negotiation). For API-only routes.
   * @param {import('http').IncomingMessage} req
   * @param {import('http').ServerResponse} res
   * @param {() => Promise<void>} onJSON
   */
  jsonOnly (req, res, onJSON) {
    return (async () => {
      try {
        await onJSON();
      } catch (error) {
        res.status(500).json({
          status: 'error',
          message: error && error.message ? error.message : String(error)
        });
      }
    })();
  }

  /**
   * If the request’s first `Accept` type is `text/html`, send the configured shell; otherwise return false.
   * @param {import('http').IncomingMessage} req
   * @param {import('http').ServerResponse} res
   * @returns {boolean} true if a response was sent
   */
  serveSpaShellIfHtmlNavigation (req, res) {
    if (!acceptFirstHtmlNavigation(req)) return false;
    const html = this.getApplicationHtml();
    if (typeof html !== 'string' || !html) return false;
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.status(200).send(html);
    return true;
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

    // Write to access log file if stream is available
    if (this.accessLogStream) {
      this.accessLogStream.write(asApache + '\n');
    }

    // this.emit('log', asApache);

    return next();
  }

  _headerMiddleware (req, res, next) {
    res.header('X-Powered-By', '@fabric/http');
    if (this.settings.cors) {
      res.header('Access-Control-Allow-Origin', '*');
      res.header('Access-Control-Allow-Headers', 'accept, content-type, authorization, x-fabric-identity');
      res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, PUT, DELETE, PATCH, HEAD');
    }
    res.header('Allow', 'GET, POST, OPTIONS, PUT, DELETE, PATCH, HEAD, SEARCH');
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

  /**
   * Register POST JSON-RPC endpoints that delegate to `_handleCall` (same surface as WebSocket JSONCall).
   * @private
   */
  _attachJsonRpcHttpRoutes () {
    const cfg = this.settings.jsonRpc;
    if (!cfg || cfg.enabled === false) return;

    const paths = Array.isArray(cfg.paths) && cfg.paths.length ? cfg.paths : ['/services/rpc'];
    const handler = async (req, res) => {
      try {
        const body = req && req.body ? req.body : {};
        const id = body.id != null ? body.id : null;
        if (cfg.requireAuth === true && !this._isJsonRpcTransportAuthorized(req)) {
          return res.status(401).json({
            jsonrpc: '2.0',
            id,
            error: { code: -32001, message: 'Unauthorized: valid bearer/session token required for JSON-RPC' }
          });
        }
        const method = body.method;
        let params = body.params;
        if (params === undefined || params === null) params = [];
        if (!Array.isArray(params)) params = [params];

        if (!method) {
          res.status(400).json({
            jsonrpc: '2.0',
            id,
            error: { code: -32600, message: 'Invalid Request: method required' }
          });
          return;
        }

        let result = null;
        try {
          result = await this._handleCall({ method, params });
        } catch (callErr) {
          if ((this.settings.verbosity || 0) >= 3) console.error('[HTTP:SERVER] RPC call error:', callErr);
          res.status(500).json({
            jsonrpc: '2.0',
            id,
            error: {
              code: -32603,
              message: callErr && callErr.message ? callErr.message : 'Internal error'
            }
          });
          return;
        }

        res.status(200).json({
          jsonrpc: '2.0',
          id,
          result
        });
      } catch (err) {
        console.error('[HTTP:SERVER] RPC handler error:', err);
        res.status(500).json({
          jsonrpc: '2.0',
          id: null,
          error: {
            code: -32603,
            message: err && err.message ? err.message : 'Internal error'
          }
        });
      }
    };

    for (let p = 0; p < paths.length; p++) {
      const pathStr = paths[p];
      if (this.settings.cors) {
        this.express.options(pathStr, (req, res) => {
          res.status(204).end();
        });
      }
      this.express.post(pathStr, handler);
    }
  }

  _computeSitemapUrls () {
    const cfg = this.settings.sitemap || {};
    const includeParameterized = cfg.includeParameterized === true;
    const protocol = cfg.protocol || 'http';
    const host = cfg.hostname || this.settings.hostname || 'localhost';
    const port = Number(this.settings.port);
    const defaultPort = (protocol === 'https') ? 443 : 80;
    const authority = (port && port !== defaultPort) ? `${host}:${port}` : host;
    const base = cfg.baseUrl || `${protocol}://${authority}`;
    const seen = new Set();
    const urls = [];

    const shouldIncludePath = (p) => {
      if (!p || typeof p !== 'string') return false;
      if (!includeParameterized && /[:*]/.test(p)) return false;
      return true;
    };

    const pushUrl = (candidate) => {
      if (!candidate) return;
      const s = String(candidate).trim();
      if (!s) return;

      let absolute = s;
      if (!/^https?:\/\//i.test(s)) {
        const normalized = s.startsWith('/') ? s : `/${s}`;
        absolute = `${base}${normalized}`;
      }

      if (seen.has(absolute)) return;
      seen.add(absolute);
      urls.push(absolute);
    };

    if (cfg.includeRoot !== false) pushUrl('/');
    if (cfg.includeStaticIndex === true) pushUrl('/index.html');

    if (cfg.includeCustomRoutes !== false) {
      for (let i = 0; i < this.customRoutes.length; i++) {
        const route = this.customRoutes[i] || {};
        const method = String(route.method || '').toUpperCase();
        const routePath = route.path || route.route;
        if ((method === 'GET' || method === 'HEAD') && shouldIncludePath(routePath)) pushUrl(routePath);
      }
    }

    if (cfg.includeResourceRoutes !== false) {
      for (let i = 0; i < this.routes.length; i++) {
        const route = this.routes[i] || {};
        if (shouldIncludePath(route.path)) pushUrl(route.path);
      }
    }

    if (cfg.includeJsonRpc === true && this.settings.jsonRpc && this.settings.jsonRpc.enabled) {
      const rpcPaths = Array.isArray(this.settings.jsonRpc.paths) ? this.settings.jsonRpc.paths : ['/rpc', '/services/rpc'];
      for (let i = 0; i < rpcPaths.length; i++) {
        if (shouldIncludePath(rpcPaths[i])) pushUrl(rpcPaths[i]);
      }
    }

    const extras = Array.isArray(cfg.urls) ? cfg.urls : [];
    for (let i = 0; i < extras.length; i++) {
      pushUrl(extras[i]);
    }

    return urls;
  }

  _handleSitemapRequest (req, res) {
    const urls = this._computeSitemapUrls();
    const body = [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
      ...urls.map((u) => `  <url><loc>${xmlEscape(u)}</loc></url>`),
      '</urlset>'
    ].join('\n');

    res.setHeader('Content-Type', 'application/xml; charset=utf-8');
    res.status(200).send(body);
  }

  /**
   * SPA-style fallback: after static misses, serve `index.html` for navigational GETs (html Accept, no file extension).
   * @private
   */
  _maybeServeSpaShell (req, res, next) {
    if (!this.settings.spaFallback) return next();
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();
    const accept = req.headers.accept || '';
    if (!accept.includes('text/html')) return next();

    const pth = req.path || '';
    const ex = this.settings.spaFallbackExclude;
    if (ex && typeof ex.test === 'function' && ex.test(pth)) return next();

    const last = path.basename(pth);
    if (last.includes('.') && last !== this.settings.spaFallbackIndex) {
      const ext = last.slice(last.lastIndexOf('.') + 1);
      if (ext.length <= 8 && /^[a-z0-9]+$/i.test(ext)) return next();
    }

    const indexFile = resolvedPathUnderStaticRoot(
      this.settings.spaFallbackIndex || 'index.html',
      this._staticRoot
    );
    if (!indexFile) return next();

    if (req.method === 'HEAD') {
      res.status(200);
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      return res.end();
    }

    return res.sendFile(indexFile, (err) => {
      if (err) next();
    });
  }

  /**
   * Notify subscribers of a state change
   * @param {String} path - The path that changed
   * @param {*} value - The new value
   */
  _notifySubscribers (path, value) {
    const message = Message.fromVector(['PATCH', {
      path,
      value
    }]);

    if (this._rootKey && this._rootKey.private) message.signWithKey(this._rootKey);

    // Iterate through all connections and notify those subscribed to this path
    Object.entries(this.connections).forEach(([handle, socket]) => {
      if (socket.subscriptions && socket.subscriptions.has(path)) {
        try {
          this._sendTo(handle, message.toBuffer());
        } catch (error) {
          console.error('[SERVER]', 'Failed to notify subscriber:', handle, error);
        }
      }
    });
  }

  async _applyChanges (ops) {
    const sample = Object.assign({}, this.state);
    const reference = new Actor(sample);

    try {
      // Apply changes to state
      monitor.applyPatch(sample, ops, function isValid () {
        return true;
      }, true);

      this._state.parent = reference.id;
      this._state.content = sample;

      // Notify subscribers of changes
      ops.forEach(op => {
        if (op.op === 'replace' || op.op === 'add') {
          this._notifySubscribers(op.path, op.value);
        }
      });

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

    if (this.settings.debug) this.debug('Resource mounted:', resource);

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
    if (!result) return next();

    // console.debug('Preparing to format:', req.path);

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

  /**
   * Standardized content negotiation for route handlers.
   * Handles JSON/HTML negotiation with proper precedence.
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   * @param {*} data - Data to send
   * @param {Object} options - Formatting options
   * @param {String} options.title - HTML page title
   * @param {String} options.resourceName - Resource name for display
   * @param {String} options.resourceType - Resource type (for HTML rendering)
   */
  formatResponse (req, res, data, options = {}) {
    const { title = 'Hub', resourceName = 'Resource', resourceType = null } = options;
    const accept = req.headers.accept || '';
    const hasJson = accept.includes('application/json');
    const hasHtml = accept.includes('text/html');

    // Prefer JSON when both are present with equal q-values
    if (hasJson && hasHtml) {
      const jsonMatch = accept.match(/application\/json(?:\s*;\s*q=([\d.]+))?/);
      const htmlMatch = accept.match(/text\/html(?:\s*;\s*q=([\d.]+))?/);
      const jsonQ = jsonMatch && jsonMatch[1] ? parseFloat(jsonMatch[1]) : 1.0;
      const htmlQ = htmlMatch && htmlMatch[1] ? parseFloat(htmlMatch[1]) : 1.0;

      if (htmlQ <= jsonQ) {
        res.header('Content-Type', 'application/json');
        return res.json(data);
      }
    }

    // Format content for HTML
    let content = '';
    if (data === null || data === undefined) {
      content = '<p class="empty">No data available.</p>';
    } else if (Array.isArray(data)) {
      if (data.length === 0) {
        content = '<p class="empty">No items found.</p>';
      } else {
        content = `<ul>${data.map(item => `<li><pre>${JSON.stringify(item, null, 2)}</pre></li>`).join('')}</ul>`;
      }
    } else if (typeof data === 'object') {
      content = `<pre>${JSON.stringify(data, null, 2)}</pre>`;
    } else {
      content = `<p>${String(data)}</p>`;
    }

    return res.format({
      'application/json': function () {
        res.header('Content-Type', 'application/json');
        return res.json(data);
      },
      'text/html': function () {
        res.header('Content-Type', 'text/html');
        const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title} - Hub</title>
  <style>
    body { font-family: system-ui, sans-serif; margin: 2rem; line-height: 1.6; }
    h1 { color: #333; border-bottom: 2px solid #eee; padding-bottom: 0.5rem; }
    ul { list-style: none; padding: 0; }
    li { padding: 1rem; margin: 0.5rem 0; background: #f5f5f5; border-radius: 4px; }
    pre { margin: 0; white-space: pre-wrap; word-wrap: break-word; }
    .empty { color: #666; font-style: italic; }
    .error { color: #d32f2f; background: #ffebee; padding: 1rem; border-radius: 4px; border-left: 4px solid #d32f2f; }
  </style>
</head>
<body>
  <h1>${resourceName}</h1>
  ${content}
</body>
</html>`;
        return res.send(html);
      },
      default: function () {
        res.header('Content-Type', 'application/json');
        return res.json(data);
      }
    });
  }

  async start () {
    if ((this.settings.verbosity || 0) >= 4) console.debug('[HTTP:SERVER]', 'Starting...');
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

    if (this.settings.debug) console.debug('[HTTP:SERVER]', 'resources:', this.settings.resources);

    for (let name in this.settings.resources) {
      const definition = this.settings.resources[name];
      const resource = await this.define(name, definition);

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

    {
      const raw = String(this.settings.assets != null ? this.settings.assets : 'assets').trim() || 'assets';
      if (path.isAbsolute(raw)) {
        this._staticRoot = path.resolve(raw);
      } else {
        const cwd = process.cwd();
        this._staticRoot = path.resolve(cwd, raw);
        const under = path.relative(cwd, this._staticRoot);
        if (under.startsWith('..')) {
          throw new Error(`[HTTP:SERVER] settings.assets must not escape process.cwd() (resolved from ${raw})`);
        }
      }
    }

    const listenPort = Number(this.settings.port);
    if (!Number.isInteger(listenPort) || listenPort < 1 || listenPort > 65535) {
      throw new Error(`[HTTP:SERVER] Invalid port: ${this.settings.port} (require integer 1-65535)`);
    }
    this.settings.port = listenPort;

    // Middlewares
    this.express.use(this._logMiddleware.bind(this));
    this.express.use(extractor());
    this.express.use(auth.bind(this));

    // Custom Headers
    this.express.use(this._headerMiddleware.bind(this));
    this.express.use(this._redirectMiddleware.bind(this));

    if (this.settings.compression !== false) {
      try {
        const compression = require('compression');
        this.express.use(compression());
      } catch (err) {
        this.emit('debug', '[HTTP:SERVER] compression not available; npm i compression for gzip');
      }
    }

    const st = this.settings.static || {};
    let maxAgeMs = 0;
    if (st.maxAge != null) {
      const m = Number(st.maxAge);
      maxAgeMs = Number.isInteger(m) && m >= 0 ? m : 0;
    } else {
      let cs = Number(st.cacheSeconds);
      if (!Number.isInteger(cs) || cs < 0) cs = 0;
      maxAgeMs = cs * 1000;
    }

    let indexOpt = ['index.html'];
    if (st.index === false) indexOpt = false;
    else if (Array.isArray(st.index)) indexOpt = st.index;

    this.express.use(express.static(this._staticRoot, {
      maxAge: maxAgeMs,
      dotfiles: st.dotfiles || 'ignore',
      etag: st.etag !== false,
      index: indexOpt,
      fallthrough: st.fallthrough !== false,
      immutable: !!st.immutable,
      setHeaders: (res, filePath) => mergeStaticSetHeaders(res, filePath, st.setHeaders)
    }));

    /* Second static root: this package’s `assets/` (Fomantic / semantic, etc.). The app’s `path` is
     * always mounted first — files you ship under that directory win; anything missing falls through
     * here. See e.g. `fabric-clean/examples/http.js` for a minimal `HTTP.Server` consumer. */
    const packageAssets = fabricHttpPackageAssetsDir();
    if (packageAssets) {
      this.express.use(express.static(packageAssets, {
        maxAge: maxAgeMs,
        dotfiles: st.dotfiles || 'ignore',
        etag: st.etag !== false,
        index: false,
        fallthrough: st.fallthrough !== false,
        immutable: !!st.immutable,
        setHeaders: (res, filePath) => mergeStaticSetHeaders(res, filePath, st.setHeaders)
      }));
    }

    this.express.use(this._roleMiddleware.bind(this));

    // this.express.all('/services/graphql', graphql({ schema: this.graphQLSchema }))

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

    // OPTIONS `/` — server metadata for API discovery.
    this.express.options('/', this._handleOptionsRequest.bind(this));
    const sitemapCfg = this.settings.sitemap || {};
    if (sitemapCfg.enabled !== false) {
      const sitemapPath = sitemapCfg.path || '/sitemap.xml';
      this.express.get(sitemapPath, this._handleSitemapRequest.bind(this));
    }
    // GET `/` — runs after `express.static` above; if `assets/index.html` exists, static serves `/` and this handler is skipped.
    this.express.get('/', this._handleIndexRequest.bind(this));

    this._addAllRoutes();

    // handle custom routes.
    // TODO: abolish this garbage in favor of resources.
    for (let i = 0; i < this.customRoutes.length; i++) {
      const route = this.customRoutes[i];

      // Skip invalid routes
      if (!route || !route.method || typeof route.method !== 'string') {
        console.warn('[HTTP:SERVER]', 'Skipping invalid route:', route);
        continue;
      }

      // Support both 'path' and 'route' keys for path
      const path = route.path || route.route;
      if (!path || !route.handler) {
        console.warn('[HTTP:SERVER]', 'Skipping route with missing path or handler:', route);
        continue;
      }

      const method = route.method.toLowerCase();
      switch (method) {
        case 'get':
        case 'put':
        case 'post':
        case 'patch':
        case 'delete':
        case 'search':
        case 'options':
          this.express[method](path, route.handler);
          break;
        default:
          console.warn('[HTTP:SERVER]', 'Skipping route with unsupported method:', method);
          break;
      }
    }

    // JSON-RPC over HTTP — after body parsers and `settings.middlewares` (e.g. security headers) so they apply to `POST /rpc`.
    this._attachJsonRpcHttpRoutes();
    if (this.settings.jsonRpc && this.settings.jsonRpc.enabled && this.settings.jsonRpc.requireAuth !== true) {
      this.emit('warning', '[HTTP:SERVER] JSON-RPC auth is disabled (jsonRpc.requireAuth=false). Endpoints are publicly callable.');
    }

    // Attach the internal router (optional SPA shell before resource router)
    this.express.get('/*', this._maybeServeSpaShell.bind(this), this._handleRoutableRequest.bind(this));
    this.express.put('/*', this._handleRoutableRequest.bind(this));
    this.express.post('/*', this._handleRoutableRequest.bind(this));
    this.express.patch('/*', this._handleRoutableRequest.bind(this));
    this.express.delete('/*', this._handleRoutableRequest.bind(this));
    this.express.options('/*', this._handleRoutableRequest.bind(this));

    const servicesTestPrize = (req, res) => res.send({ message: 'I am the prize!' });
    const pay = this.settings.payments || {};
    const testPaymentWall =
      payments.isPaymentsEnabled(pay) &&
      pay.exposePaymentTestRoute !== false &&
      pay.exposePaymentTestRoute !== '0';
    if (testPaymentWall) {
      this.express.get('/services/test', payments.bind(this), servicesTestPrize);
    } else {
      this.express.get('/services/test', servicesTestPrize);
    }

    // create the HTTP server
    // NOTE: stoppable is used here to force immediate termination of
    // all connections.  We may want to defer to default APIs for portability reasons.
    this.http = stoppable(http.createServer(this.express), 0);

    // attach a WebSocket handler
    const wsOpts = { server: this.http };
    const wsCfg = this.settings.websocket || {};
    const wsTokenConfigured = Boolean(wsCfg.clientToken || wsCfg.sharedSecret);
    const wsTokenRequired = wsCfg.requireClientToken === true || wsCfg.requireClientToken === '1' || wsCfg.requireClientToken === 1;
    if (wsTokenConfigured && wsTokenRequired) {
      wsOpts.verifyClient = this._verifyWebSocketClient.bind(this);
    }
    this.wss = new WebSocket.Server(wsOpts);

    // set up the WebSocket connection handler
    this.wss.on('connection', this._handleWebSocket.bind(this));

    this.agent.on('debug', (msg) => {
      if ((this.settings.verbosity || 0) >= 5) console.debug('debug:', msg);
    });

    this.agent.on('log', (msg) => {
      if ((this.settings.verbosity || 0) >= 4) console.log('log:', msg);
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

    this._registerMethod('RegisterWebRTCPeer', this._rpcRegisterWebRtcPeer);
    this._registerMethod('UnregisterWebRTCPeer', this._rpcUnregisterWebRtcPeer);
    this._registerMethod('ListWebRTCPeers', this._rpcListWebRtcPeers);

    await this.agent.start();

    if (this.app) {
      try {
        await this.app.start();
      } catch (E) {
        console.error('Could not start this app:', E);
      }
    }

    // Open access log file stream
    try {
      // Use literal relative paths so static analysis (e.g. Semgrep non-literal fs filename) matches runtime intent.
      fs.mkdirSync('logs', { recursive: true });
      const logRel = 'logs/access.log';
      this.settings.accessLog = path.resolve(process.cwd(), logRel);
      this.accessLogStream = fs.createWriteStream('logs/access.log', { flags: 'a' });
      this.emit('debug', `[HTTP:SERVER] Access log opened: ${this.settings.accessLog}`);
    } catch (E) {
      console.error('[HTTP:SERVER] Could not open access log file:', E);
    }

    const self = this;
    function notifyReady () {
      self.status = 'STARTED';
      self.emit('ready', {
        id: self.id
      });
    }

    if (this.settings.listen) {
      this.http.on('listening', notifyReady);
      await this.http.listen(this.settings.port, this.interface);
    } else {
      if ((this.settings.verbosity || 0) >= 3) {
        console.warn('[HTTP:SERVER]', 'Listening is disabled.  Only events will be emitted!');
      }
      notifyReady();
    }

    // commit to our results
    // await this.commit();

    if ((this.settings.verbosity || 0) >= 3) {
      this.emit('warning', '[WARNING] Unencrypted transport!  You should consider changing the `host` property in your config, or set up a TLS server to encrypt traffic to and from this node.');
    }
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

    // Stop accepting connections
    try {
      if (server.http) await server.http.stop();
    } catch (E) {
      console.error('Could not stop HTTP listener:', E);
    }

    // Close access log stream
    if (this.accessLogStream) {
      try {
        this.accessLogStream.end();
        this.accessLogStream = null;
        this.emit('debug', `[HTTP:SERVER] Access log closed: ${this.settings.accessLog}`);
      } catch (E) {
        console.error('[HTTP:SERVER] Could not close access log file:', E);
      }
    }

    // Stop peer connections
    await this.agent.stop();

    // Stop the server app (if it exists)
    if (server.app) {
      try {
        await server.app.stop();
      } catch (E) {
        console.error('Could not stop server app:', E);
      }
    }

    // Set status to stopped and emit stopped event
    this.status = 'stopped';
    server.emit('stopped');

    if (this.settings.verbosity >= 4) this.emit('log', '[HTTP:SERVER]', 'Stopped!');
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
