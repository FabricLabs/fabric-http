'use strict';

/**
 * Per-request JSON body-parser limit for Fabric HTTPServer.
 * Large bodies (Hub CreateDocument base64) stay on JSON-RPC paths only.
 *
 * @param {Object} [settings]
 * @param {string|null} [settings.jsonBodyLimit]
 * @param {string|null} [settings.jsonBodyLimitDefault]
 * @param {string[]} [settings.jsonBodyLargePaths]
 * @param {Object} [settings.jsonRpc]
 * @param {Object} [req] Express-like request (`method`, `path`)
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {string}
 */
function resolveJsonBodyLimitForRequest (settings = {}, req = {}, env = process.env) {
  const large = (settings && settings.jsonBodyLimit) ||
    (env && env.FABRIC_HTTP_JSON_LIMIT) ||
    '12mb';
  const small = (settings && settings.jsonBodyLimitDefault) ||
    (env && env.FABRIC_HTTP_JSON_LIMIT_DEFAULT) ||
    '100kb';
  if (!req || String(req.method || '').toUpperCase() !== 'POST') return small;

  const pathName = String(req.path || '').split('?')[0] || '';
  const largePaths = new Set();
  const cfg = settings && settings.jsonRpc;
  if (cfg && cfg.enabled !== false) {
    const rpcPaths = Array.isArray(cfg.paths) && cfg.paths.length
      ? cfg.paths
      : ['/services/rpc'];
    for (let i = 0; i < rpcPaths.length; i++) largePaths.add(String(rpcPaths[i]));
  }
  // Hub mounts CreateDocument on POST /services/rpc even when built-in jsonRpc is off.
  largePaths.add('/services/rpc');
  const extra = (settings && settings.jsonBodyLargePaths) || [];
  if (Array.isArray(extra)) {
    for (let i = 0; i < extra.length; i++) {
      if (extra[i]) largePaths.add(String(extra[i]));
    }
  }
  return largePaths.has(pathName) ? large : small;
}

module.exports = {
  resolveJsonBodyLimitForRequest
};
