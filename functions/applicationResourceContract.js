'use strict';

/**
 * Application Resource Contract (ARC) for HTTP `OPTIONS /`.
 *
 * Peers and legacy web clients discover a Fabric HTTP node's contract identity,
 * declared resources, service endpoints, and web capabilities from one OPTIONS
 * response — the same discovery shape {@link @fabric/core Remote.enumerate}
 * / Hub desktop probes already expect, enriched for peering + contract publish.
 *
 * @see fabric DEVELOPERS.md §1.1 / §3 (Application Resource Contracts)
 */

const Actor = require('@fabric/core/types/actor');

const ARC_TYPE = 'ApplicationResourceContract';
// target version == 1; we will not update this as the release will be version 0.1.0
const ARC_VERSION = 1;
const DEFAULT_ALLOW = Object.freeze([
  'GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'SEARCH', 'META'
]);

/**
 * Plain resource catalog for JSON (avoid dumping class instances).
 * @param {object} definitions Map of name → FabricResource | definition
 * @returns {object}
 */
function resourceCatalog (definitions) {
  const out = {};
  if (!definitions || typeof definitions !== 'object') return out;
  for (const name of Object.keys(definitions)) {
    const res = definitions[name];
    if (!res || typeof res !== 'object') continue;
    const def = (res.definition && typeof res.definition === 'object')
      ? res.definition
      : res;
    const routes = (res.routes && typeof res.routes === 'object')
      ? Object.assign({}, res.routes)
      : (def.routes && typeof def.routes === 'object' ? Object.assign({}, def.routes) : null);
    const route = def.route != null ? String(def.route) : null;
    const paths = (def.paths && typeof def.paths === 'object')
      ? Object.assign({}, def.paths)
      : (routes
        ? { list: routes.list, view: routes.view }
        : (route ? { list: route, view: `${route}/:id` } : undefined));
    const entry = {
      name: res.name || def.name || name,
      description: res.description || def.description || '',
      components: def.components || res.components || undefined,
      roles: def.roles || undefined,
      constraints: def.constraints || undefined,
      paths: paths || undefined,
      routes: routes || undefined
    };
    if (route) entry.route = route;
    out[name] = entry;
  }
  return out;
}

/**
 * Stable CONTRACT_PUBLISH-style definition + Actor id for the HTTP application.
 * @param {object} settings HTTPServer settings
 * @param {object} resources Catalog from {@link resourceCatalog}
 * @param {object|null} [explicit] Optional `{ id?, definition? }` override
 * @returns {{ id: string, definition: object, messageType: string }}
 */
function buildContractBlock (settings, resources, explicit) {
  if (explicit && typeof explicit === 'object') {
    const definition = explicit.definition && typeof explicit.definition === 'object'
      ? explicit.definition
      : explicit;
    const id = explicit.id != null
      ? String(explicit.id)
      : String(new Actor(definition).id);
    return {
      id,
      definition,
      messageType: 'CONTRACT_PUBLISH'
    };
  }
  const definition = {
    name: settings && settings.name,
    description: settings && settings.description,
    resources
  };
  return {
    id: String(new Actor(definition).id),
    definition,
    messageType: 'CONTRACT_PUBLISH'
  };
}

/**
 * Legacy web + Fabric capability flags.
 * @param {object} settings
 * @param {object} [fabricCaps]
 * @returns {{ http: object, fabric: object }}
 */
function buildCapabilities (settings, fabricCaps) {
  const jsonRpc = (settings && settings.jsonRpc) || {};
  const rpcEnabled = jsonRpc.enabled !== false &&
    Array.isArray(jsonRpc.paths) &&
    jsonRpc.paths.length > 0;
  return {
    http: {
      allow: DEFAULT_ALLOW.slice(),
      cors: !!(settings && settings.cors),
      spaFallback: !(settings && settings.spaFallback === false),
      jsonRpc: rpcEnabled,
      contentTypes: ['application/json', 'text/html']
    },
    fabric: Object.assign({
      p2p: false,
      webrtcSignaling: false,
      contractPublish: true
    }, fabricCaps && typeof fabricCaps === 'object' ? fabricCaps : {})
  };
}

/**
 * Merge settings.services with enricher services and auto RPC paths.
 * @param {object} settings
 * @param {object} [extraServices]
 * @returns {object}
 */
function buildServices (settings, extraServices) {
  const out = Object.assign(
    {},
    (settings && settings.services && typeof settings.services === 'object')
      ? settings.services
      : {},
    (extraServices && typeof extraServices === 'object') ? extraServices : {}
  );
  const jsonRpc = (settings && settings.jsonRpc) || {};
  if (jsonRpc.enabled !== false && Array.isArray(jsonRpc.paths) && jsonRpc.paths.length) {
    if (!out.rpc || typeof out.rpc !== 'object') {
      out.rpc = { paths: jsonRpc.paths.slice() };
    } else if (!out.rpc.paths) {
      out.rpc = Object.assign({}, out.rpc, { paths: jsonRpc.paths.slice() });
    }
  }
  return out;
}

/**
 * Build the OPTIONS `/` Application Resource Contract document.
 *
 * @param {object} server FabricHTTPServer-like (`settings`, `definitions`)
 * @param {object} [opts]
 * @param {object} [opts.contract] Explicit contract `{ id?, definition }`
 * @param {object} [opts.services] Extra / override service map (e.g. peering)
 * @param {object} [opts.status] Live status (e.g. `{ oracleAttestation }`)
 * @param {object} [opts.fabricCapabilities] Override fabric capability flags
 * @param {Array|object} [opts.methods] Optional RPC method listing
 * @returns {object}
 */
function buildApplicationResourceContract (server, opts = {}) {
  const settings = (server && server.settings) || {};
  const definitions = (server && server.definitions) || {};
  const resources = resourceCatalog(definitions);
  const contract = buildContractBlock(
    settings,
    resources,
    opts.contract || settings.applicationContract || null
  );
  const doc = {
    '@type': ARC_TYPE,
    version: ARC_VERSION,
    name: settings.name || 'FabricHTTPServer',
    description: settings.description || '',
    contract,
    resources,
    services: buildServices(settings, opts.services),
    capabilities: buildCapabilities(settings, opts.fabricCapabilities || settings.fabricCapabilities)
  };
  if (opts.methods != null) doc.methods = opts.methods;
  else if (settings.methods != null) doc.methods = settings.methods;
  if (opts.status != null) doc.status = opts.status;
  else if (settings.status != null && typeof settings.status === 'object' && !Array.isArray(settings.status)) {
    // Prefer enricher status; ignore bare Service state `{ status: 'PAUSED' }` strings.
    if (settings.status.oracleAttestation || settings.status.attestation) {
      doc.status = settings.status;
    }
  }
  return doc;
}

/**
 * True when a JSON body looks like an ARC / Fabric HTTP OPTIONS document.
 * @param {*} json
 * @returns {boolean}
 */
function isApplicationResourceContract (json) {
  if (!json || typeof json !== 'object' || Array.isArray(json)) return false;
  if (json['@type'] != null && json['@type'] !== ARC_TYPE) return false;
  if (typeof json.name !== 'string' || !json.name) return false;
  if (!json.resources || typeof json.resources !== 'object' || Array.isArray(json.resources)) {
    return false;
  }
  return true;
}

module.exports = {
  ARC_TYPE,
  ARC_VERSION,
  DEFAULT_ALLOW,
  resourceCatalog,
  buildContractBlock,
  buildCapabilities,
  buildServices,
  buildApplicationResourceContract,
  isApplicationResourceContract
};
