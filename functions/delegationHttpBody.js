'use strict';

/**
 * @fileoverview Request and response helpers shared by the delegation routes
 * (`fabricDelegationHttp`, `fabricDelegationMailbox`, `fabricDelegate`).
 * Works with Express (`req.body` already parsed) and plain `http`.
 */

const { fabricUriFromBody } = require('./httpRequestTrust');

/** Largest body any delegation route reads. */
const MAX_FRAME_BODY_BYTES = 96 * 1024;

/**
 * @private
 * @param {import('http').IncomingMessage} req
 * @param {number} limit
 * @returns {Promise<string>}
 */
function readRequestText (req, limit) {
  if (!req || typeof req.on !== 'function' || req.readableEnded || req.complete) {
    return Promise.resolve('');
  }
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(Object.assign(new Error('request body too large'), { status: 413 }));
        req.destroy();
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

/**
 * Address used for rate limits: the socket address, or the last
 * `X-Forwarded-For` hop when `trustProxy` (the hop our own proxy added).
 * @param {import('http').IncomingMessage} req
 * @param {boolean} [trustProxy]
 * @returns {string}
 */
function clientAddress (req, trustProxy = false) {
  if (trustProxy) {
    const forwarded = String((req && req.headers && req.headers['x-forwarded-for']) || '').split(',').map((s) => s.trim()).filter(Boolean);
    if (forwarded.length) return forwarded[forwarded.length - 1];
  }
  return String((req && req.socket && req.socket.remoteAddress) || 'unknown');
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
  MAX_FRAME_BODY_BYTES,
  readRequestText,
  readFrame,
  sendJson,
  clientAddress,
  pathParam,
  createRateLimit
};
