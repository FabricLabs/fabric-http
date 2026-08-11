'use strict';

/**
 * Shared PeeringCapability HTTP helpers for Hub and light peers (LiveRelay).
 * Claim builders stay app-specific; this module shapes envelopes and raw-http mounts.
 */

let oracleAttestation;
try {
  oracleAttestation = require('./oracleAttestation');
} catch (_) {
  oracleAttestation = null;
}

const ATTESTATION_TYPE = (oracleAttestation && oracleAttestation.ATTESTATION_TYPE) || 'OracleAttestation';
const KIND_PEERING = (oracleAttestation && oracleAttestation.KIND_PEERING) || 'PeeringCapability';
const PEERING_BASE = '/services/peering';

/**
 * @param {object} [opts]
 * @param {boolean} [opts.available=true]
 * @param {string} [opts.endpointBasePath]
 * @param {string} [opts.oracleDescription]
 * @param {object} [opts.claim]
 * @param {object|null} [opts.oracleAttestation]
 * @returns {object}
 */
function buildPeeringCapabilitiesBody (opts = {}) {
  const base = opts.endpointBasePath || PEERING_BASE;
  const att = opts.oracleAttestation != null ? opts.oracleAttestation : null;
  const body = {
    service: 'peering',
    available: opts.available !== false,
    endpointBasePath: base,
    attestationType: ATTESTATION_TYPE,
    kind: KIND_PEERING,
    oracle: {
      name: 'Oracle',
      description: opts.oracleDescription ||
        'Signed claims anchored to the node secp256k1 identity (see @fabric/core/types/oracle)'
    },
    attestationUrl: att ? `${base}/attestation` : null,
    oracleAttestation: att
  };
  if (opts.claim != null) body.claim = opts.claim;
  return body;
}

/**
 * @param {string} pathname
 * @param {string} [method]
 * @param {string} [basePath]
 * @returns {boolean}
 */
function isPeeringHttpPath (pathname, method, basePath = PEERING_BASE) {
  const m = String(method || 'GET').toUpperCase();
  const base = String(basePath || PEERING_BASE).replace(/\/$/, '') || PEERING_BASE;
  if (m === 'OPTIONS' && (pathname === '/' || pathname === '')) return true;
  if (pathname === base || pathname === `${base}/` || pathname === `${base}/attestation`) {
    return m === 'GET' || m === 'HEAD' || m === 'OPTIONS';
  }
  return false;
}

/**
 * @param {import('http').ServerResponse} res
 * @param {string} method
 * @param {number} code
 * @param {object} obj
 * @returns {boolean}
 */
function writePeeringJson (res, method, code, obj) {
  const body = JSON.stringify(obj, null, 2);
  res.writeHead(code, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
    'Access-Control-Allow-Headers': 'Accept, Content-Type, Authorization',
    Allow: 'GET, HEAD, OPTIONS'
  });
  if (String(method || 'GET').toUpperCase() === 'HEAD') {
    res.end();
    return true;
  }
  res.end(body);
  return true;
}

function writePeeringOptions (res) {
  res.writeHead(204, {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
    'Access-Control-Allow-Headers': 'Accept, Content-Type, Authorization',
    Allow: 'GET, HEAD, OPTIONS'
  });
  res.end();
  return true;
}

/**
 * Raw Node `http` peering discovery mount (LiveRelay / light peers).
 * Hub Express routes may use {@link buildPeeringCapabilitiesBody} only.
 *
 * @param {import('http').IncomingMessage} req
 * @param {import('http').ServerResponse} res
 * @param {string} pathname
 * @param {object} deps
 * @param {() => object} deps.getCapabilities
 * @param {() => object|null} [deps.getAttestation]
 * @param {() => object} [deps.getRootContract] OPTIONS /
 * @param {string} [deps.endpointBasePath]
 * @returns {boolean} true when response written
 */
function tryHandlePeeringHttp (req, res, pathname, deps = {}) {
  const method = String(req.method || 'GET').toUpperCase();
  const base = String(deps.endpointBasePath || PEERING_BASE).replace(/\/$/, '') || PEERING_BASE;
  if (!isPeeringHttpPath(pathname, method, base)) return false;

  if (method === 'OPTIONS' && (pathname === '/' || pathname === '')) {
    if (typeof deps.getRootContract !== 'function') return false;
    return writePeeringJson(res, method, 200, deps.getRootContract());
  }

  if (pathname === base || pathname === `${base}/`) {
    if (method === 'OPTIONS') return writePeeringOptions(res);
    if (typeof deps.getCapabilities !== 'function') {
      return writePeeringJson(res, method, 503, { error: 'peering unavailable' });
    }
    return writePeeringJson(res, method, 200, deps.getCapabilities());
  }

  if (pathname === `${base}/attestation`) {
    if (method === 'OPTIONS') return writePeeringOptions(res);
    let att = null;
    if (typeof deps.getAttestation === 'function') {
      try { att = deps.getAttestation(); } catch (_) { att = null; }
    } else if (typeof deps.getCapabilities === 'function') {
      const caps = deps.getCapabilities();
      att = caps && caps.oracleAttestation ? caps.oracleAttestation : null;
    }
    if (!att) return writePeeringJson(res, method, 503, { error: 'attestation unavailable' });
    return writePeeringJson(res, method, 200, att);
  }

  return false;
}

module.exports = {
  ATTESTATION_TYPE,
  KIND_PEERING,
  PEERING_BASE,
  buildPeeringCapabilitiesBody,
  isPeeringHttpPath,
  writePeeringJson,
  tryHandlePeeringHttp
};
