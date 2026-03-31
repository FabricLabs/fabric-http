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

  return new Promise((resolve, reject) => {
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
        res.on('end', () => {
          resolve({
            statusCode: res.statusCode,
            headers: res.headers,
            body: Buffer.concat(chunks).toString('utf8')
          });
        });
      }
    );
    req.on('error', reject);
    if (opts.body != null) {
      req.write(typeof opts.body === 'string' ? Buffer.from(opts.body, 'utf8') : opts.body);
    }
    req.end();
  });
}

module.exports = { httpRequest };
