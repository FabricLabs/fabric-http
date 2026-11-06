'use strict';

/**
 * @fileoverview Who sent an HTTP request: loopback vs proxied traffic, origin
 * matching for poll gates, constant-time token compares, and the
 * `X-Fabric-Poll-Secret` helpers device-link sessions use. Also the request
 * and response helpers the delegation and Passport routes share (frame
 * bodies, JSON replies, client addresses and rate limits); they work with
 * Express (`req.body` already parsed) and plain `http`.
 */

const crypto = require('crypto');
const net = require('net');

/** Create-response header for device-link redeem / cancel. Never in a QR or URL. */
const FABRIC_POLL_HEADER = 'x-fabric-poll-secret';

/**
 * @param {string} h
 * @returns {boolean}
 */
function isLoopbackHostname (h) {
  if (typeof h !== 'string') return false;
  const x = h.toLowerCase();
  return x === 'localhost' || x === '127.0.0.1' || x === '[::1]' || x === '::1';
}

/**
 * True when the request came through a reverse proxy. Behind Caddy the socket
 * is always 127.0.0.1, so loopback must not short-circuit origin checks then.
 * @param {import('http').IncomingMessage} [req]
 * @returns {boolean}
 */
function requestHasProxyForwardHeaders (req) {
  const h = req && req.headers;
  if (!h || typeof h !== 'object') return false;
  return !!(h['x-forwarded-for'] || h['x-forwarded-host'] || h['x-real-ip'] || h.forwarded);
}

/**
 * Direct loopback client only — not proxied public traffic to a loopback bind.
 * @param {import('http').IncomingMessage} [req]
 * @returns {boolean}
 */
function isLocalRequest (req) {
  if (requestHasProxyForwardHeaders(req)) return false;
  const addr = (req && req.socket && req.socket.remoteAddress) ||
    (req && req.connection && req.connection.remoteAddress) ||
    '';
  return addr === '127.0.0.1' || addr === '::1' || addr === '::ffff:127.0.0.1';
}

/**
 * Same origin, treating any two loopback hostnames on one port as equal.
 * @param {string} clientOriginLike
 * @param {string} sessionOrigin
 * @returns {boolean}
 */
function originsMatch (clientOriginLike, sessionOrigin) {
  if (!clientOriginLike || !sessionOrigin) return false;
  if (clientOriginLike === sessionOrigin) return true;
  let clientUrl;
  let sessionUrl;
  try {
    clientUrl = new URL(clientOriginLike);
    sessionUrl = new URL(sessionOrigin);
  } catch (_) {
    return false;
  }
  if (clientUrl.protocol !== sessionUrl.protocol) return false;
  if (isLoopbackHostname(clientUrl.hostname) && isLoopbackHostname(sessionUrl.hostname)) {
    const cPort = clientUrl.port || (clientUrl.protocol === 'https:' ? '443' : '80');
    const sPort = sessionUrl.port || (sessionUrl.protocol === 'https:' ? '443' : '80');
    return cPort === sPort;
  }
  return clientUrl.host === sessionUrl.host;
}

/** @private */
function refererOriginMatches (referer, sessionOrigin) {
  if (typeof referer !== 'string' || !referer) return false;
  try {
    const u = new URL(referer);
    return originsMatch(`${u.protocol}//${u.host}`, sessionOrigin);
  } catch (_) {
    return false;
  }
}

/**
 * Browser-ish poll gate for a session bound to `sessionOrigin`. Origin and
 * Referer are forgeable by non-browser clients, so this is never a possession
 * proof; redeem and cancel also need {@link requestMayRedeemSessionSecret}.
 * @param {import('http').IncomingMessage} req
 * @param {string} sessionOrigin
 * @returns {boolean}
 */
function clientMayPollSession (req, sessionOrigin) {
  if (isLocalRequest(req)) return true;
  if (!sessionOrigin || typeof sessionOrigin !== 'string') return false;
  try {
    new URL(sessionOrigin); // eslint-disable-line no-new
  } catch (_) {
    return false;
  }
  const hdrOrigin = req.headers && req.headers.origin;
  if (typeof hdrOrigin === 'string' && originsMatch(hdrOrigin, sessionOrigin)) return true;
  return refererOriginMatches(req.headers && req.headers.referer, sessionOrigin);
}

/**
 * Constant-time UTF-8 token compare (rejects empty / length-mismatched inputs).
 * @param {string} a
 * @param {string} b
 * @returns {boolean}
 */
function tokensEqual (a, b) {
  const left = Buffer.from(String(a || ''), 'utf8');
  const right = Buffer.from(String(b || ''), 'utf8');
  if (!left.length || left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

/**
 * Poll secret from `X-Fabric-Poll-Secret` only (never a query string).
 * @param {import('http').IncomingMessage} [req]
 * @returns {string}
 */
function pollSecretFromRequest (req) {
  const h = req && req.headers;
  if (h && typeof h === 'object') {
    const header = h[FABRIC_POLL_HEADER];
    if (typeof header === 'string' && header.trim()) return header.trim();
  }
  return '';
}

/**
 * @param {import('http').IncomingMessage} [req]
 * @param {{ pollSecret?: string }} [session]
 * @returns {boolean}
 */
function requestPresentsSessionPollSecret (req, session) {
  const expected = session && typeof session.pollSecret === 'string' ? session.pollSecret : '';
  if (!expected) return false;
  return tokensEqual(pollSecretFromRequest(req), expected);
}

/**
 * Sensitive redeem / cancel: direct loopback, or the create-response secret.
 * @param {import('http').IncomingMessage} [req]
 * @param {{ pollSecret?: string }} [session]
 * @returns {boolean}
 */
function requestMayRedeemSessionSecret (req, session) {
  if (isLocalRequest(req)) return true;
  return requestPresentsSessionPollSecret(req, session);
}

/**
 * @param {object} [headers]
 * @param {string} [pollSecret]
 * @returns {object}
 */
function applyPollSecretHeader (headers, pollSecret) {
  const h = headers && typeof headers === 'object' ? { ...headers } : {};
  const secret = String(pollSecret || '').trim();
  if (secret) h['X-Fabric-Poll-Secret'] = secret;
  return h;
}

/**
 * `fabric:` string from a request body: the raw text body, or `{ fabric }`.
 * @param {string|object} body
 * @returns {string|null}
 */
function fabricUriFromBody (body) {
  let text = null;
  if (typeof body === 'string') text = body;
  else if (Buffer.isBuffer(body)) text = body.toString('utf8');
  else if (body && typeof body === 'object' && typeof body.fabric === 'string') text = body.fabric;
  if (text == null) return null;
  text = text.trim();
  return /^fabric:/i.test(text) ? text : null;
}

/** Largest body any delegation route reads. */
const MAX_FRAME_BODY_BYTES = 96 * 1024;

/**
 * @private
 * @param {import('http').IncomingMessage} req
 * @param {number} limit
 * @returns {Promise<string>}
 */
function readRequestText (req, limit) {
  if (!req || typeof req.on !== 'function' || req.readableEnded || req.readable === false) {
    return Promise.resolve('');
  }
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let over = false;
    req.on('data', (chunk) => {
      if (over) return;
      size += chunk.length;
      if (size > limit) {
        // Discard the rest without closing the socket, so the 413 still reaches the client.
        over = true;
        chunks.length = 0;
        reject(Object.assign(new Error('request body too large'), { status: 413 }));
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8').trim()));
    req.on('error', reject);
  });
}

/**
 * The `fabric:` frame a request carries: `{ frame }` (or `{ fabric }`) as
 * JSON, or the bare `fabric:` string.
 * @param {import('http').IncomingMessage} req
 * @param {number} [limit]
 * @returns {Promise<{ frame: (string|null), body: object }>}
 */
async function readFrame (req, limit = MAX_FRAME_BODY_BYTES) {
  let body = req && req.body;
  if (!body || (typeof body === 'object' && !Buffer.isBuffer(body) && !Object.keys(body).length)) {
    const text = await readRequestText(req, limit);
    if (/^fabric:/i.test(text)) return { frame: text.length <= limit ? text : null, body: {} };
    try {
      body = text ? JSON.parse(text) : {};
    } catch (_) {
      body = {};
    }
  }
  if (typeof body === 'string' || Buffer.isBuffer(body)) {
    const frame = fabricUriFromBody(body);
    return { frame: frame && frame.length <= limit ? frame : null, body: {} };
  }
  const obj = body && typeof body === 'object' ? body : {};
  const raw = typeof obj.frame === 'string' ? obj.frame : obj.fabric;
  const frame = fabricUriFromBody(typeof raw === 'string' ? raw : null);
  return { frame: frame && frame.length <= limit ? frame : null, body: obj };
}

/**
 * @param {import('http').ServerResponse} res
 * @param {number} status
 * @param {object} json
 */
function sendJson (res, status, json) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(json));
}

/** @private An address without an IPv4-mapped prefix or zone. */
function plainAddress (address) {
  const a = String(address || '').trim().toLowerCase().split('%')[0];
  return a.startsWith('::ffff:') && net.isIPv4(a.slice(7)) ? a.slice(7) : a;
}

/**
 * Is the socket peer a proxy whose `X-Forwarded-For` counts? `trustProxy`
 * `true` trusts a loopback peer only (a proxy on this host); a list (array or
 * comma string) names the proxy addresses.
 * @param {string} peer Socket address.
 * @param {(boolean|string|string[])} trustProxy
 * @returns {boolean}
 */
function isTrustedProxy (peer, trustProxy) {
  if (!trustProxy) return false;
  const address = plainAddress(peer);
  if (trustProxy === true) return address === '::1' || /^127\./.test(address);
  const list = Array.isArray(trustProxy) ? trustProxy : String(trustProxy).split(',');
  return list.map(plainAddress).filter(Boolean).includes(address);
}

/**
 * Address used for rate limits: the socket address, or the last
 * `X-Forwarded-For` hop (the one our proxy added) when the socket peer is a
 * trusted proxy ({@link isTrustedProxy}). A client that reaches the backend
 * directly cannot pick its own bucket.
 * @param {import('http').IncomingMessage} req
 * @param {(boolean|string|string[])} [trustProxy]
 * @returns {string}
 */
function clientAddress (req, trustProxy = false) {
  const peer = String((req && req.socket && req.socket.remoteAddress) || 'unknown');
  if (isTrustedProxy(peer, trustProxy)) {
    const forwarded = String((req && req.headers && req.headers['x-forwarded-for']) || '').split(',').map((s) => s.trim()).filter(Boolean);
    if (forwarded.length) return forwarded[forwarded.length - 1];
  }
  return peer;
}

/**
 * The client an address belongs to: IPv4 as is (also when IPv4-mapped, in
 * dotted or hex form), IPv6 by its /64, since one host usually holds a whole
 * /64. A dotted IPv4 tail counts as the last two groups.
 * @param {string} address
 * @returns {string}
 */
function clientGroup (address) {
  const a = String(address || '').trim().toLowerCase().split('%')[0];
  if (!net.isIPv6(a)) return a;
  const [head, tail] = a.split('::');
  const left = head ? head.split(':') : [];
  const right = tail === undefined ? [] : (tail ? tail.split(':') : []);
  const last = tail === undefined ? left : right;
  if (last.length && last[last.length - 1].includes('.')) {
    const octets = last.pop().split('.').map(Number);
    last.push(((octets[0] << 8) | octets[1]).toString(16), ((octets[2] << 8) | octets[3]).toString(16));
  }
  const groups = (tail === undefined ? left : left.concat(new Array(8 - left.length - right.length).fill('0'), right))
    .map((g) => parseInt(g, 16));
  if (groups.slice(0, 5).every((g) => g === 0) && groups[5] === 0xffff) {
    return [groups[6] >> 8, groups[6] & 0xff, groups[7] >> 8, groups[7] & 0xff].join('.');
  }
  return groups.slice(0, 4).map((g) => g.toString(16)).join(':') + '::/64';
}

/**
 * Key every rate limit counts a request by: its {@link clientGroup}.
 * @param {import('http').IncomingMessage} req
 * @param {(boolean|string|string[])} [trustProxy]
 * @returns {string}
 */
function clientKey (req, trustProxy = false) {
  return clientGroup(clientAddress(req, trustProxy));
}

/**
 * Path parameter from Express (`req.params[name]`) or a plain URL match.
 * @param {import('http').IncomingMessage} req
 * @param {string} name
 * @param {RegExp} [pattern] Applied to the pathname when there are no params.
 * @returns {string}
 */
function pathParam (req, name, pattern) {
  if (req && req.params && req.params[name] != null) return String(req.params[name]);
  if (!pattern) return '';
  try {
    const match = pattern.exec(new URL(req.url || '/', 'http://localhost').pathname);
    return match ? decodeURIComponent(match[1]) : '';
  } catch (_) {
    return '';
  }
}

/**
 * Fixed-window counter per key.
 * @param {Object} options
 * @param {number} options.limit Events per window.
 * @param {number} options.windowMs
 * @param {Function} [options.now]
 * @returns {function(string): boolean} `take(key)`: true while under the limit.
 */
function createRateLimit (options) {
  const now = options.now || (() => Date.now());
  const windows = new Map();
  return function take (key) {
    const t = now();
    let w = windows.get(key);
    if (!w || t - w.start >= options.windowMs) {
      if (windows.size > 4096) {
        for (const [k, v] of windows) if (t - v.start >= options.windowMs) windows.delete(k);
      }
      w = { start: t, count: 0 };
      windows.set(key, w);
    }
    w.count++;
    return w.count <= options.limit;
  };
}

module.exports = {
  FABRIC_POLL_HEADER,
  isLoopbackHostname,
  requestHasProxyForwardHeaders,
  isLocalRequest,
  originsMatch,
  clientMayPollSession,
  tokensEqual,
  pollSecretFromRequest,
  requestPresentsSessionPollSecret,
  requestMayRedeemSessionSecret,
  applyPollSecretHeader,
  fabricUriFromBody,
  MAX_FRAME_BODY_BYTES,
  readRequestText,
  readFrame,
  sendJson,
  clientAddress,
  isTrustedProxy,
  clientGroup,
  clientKey,
  pathParam,
  createRateLimit
};
