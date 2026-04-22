'use strict';

const http = require('http');

/**
 * Minimal HTTP/1.1 client for tests (no external deps).
 * @param {Object} opts
 * @param {string} [opts.hostname='127.0.0.1']
 * @param {number} opts.port
 * @param {string} [opts.method='GET']
 * @param {string} [opts.path='/']
 * @param {Object} [opts.headers]
 * @param {string|Buffer} [opts.body]
 * @returns {Promise<{ statusCode: number, headers: Object, body: string }>}
 */
function httpRequest (opts = {}) {
  const hostname = opts.hostname || '127.0.0.1';
  const port = opts.port;
  const method = opts.method || 'GET';
  const pathStr = opts.path || '/';
  const headers = Object.assign({}, opts.headers);
  const timeout = Number.isInteger(opts.timeout) && opts.timeout > 0 ? opts.timeout : 5000;

  return new Promise((resolve, reject) => {
    let settled = false;
    function fail (err) {
      if (settled) return;
      settled = true;
      reject(err);
    }

    const req = http.request(
      {
        hostname,
        port,
        method,
        path: pathStr,
        headers
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('error', fail);
        res.on('end', () => {
          if (settled) return;
          settled = true;
          resolve({
            statusCode: res.statusCode,
            headers: res.headers,
            body: Buffer.concat(chunks).toString('utf8')
          });
        });
      }
    );
    req.setTimeout(timeout, () => {
      req.destroy(new Error(`Request timed out after ${timeout}ms`));
    });
    req.on('error', fail);
    if (opts.body != null) {
      req.write(typeof opts.body === 'string' ? Buffer.from(opts.body, 'utf8') : opts.body);
    }
    req.end();
  });
}

module.exports = { httpRequest };
