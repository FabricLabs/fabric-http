'use strict';

/**
 * @fileoverview Client route registry shared by {@link SPA} and {@link App}
 * (`handler`), called like page.js: `handler(path, ...callbacks)`. Paths use
 * path-to-regexp 9 syntax (`/things/:id`); `*` matches every path. Nothing
 * listens to the browser until `start()`.
 */

const { match } = require('path-to-regexp');

/**
 * @returns {Function} `handler(path, ...callbacks)` with `show(path)`, `start()`, and `routes`.
 */
function createPageRouter () {
  const routes = [];

  function handler (path, ...callbacks) {
    if (typeof path === 'function') return handler('*', path, ...callbacks);
    if (typeof path !== 'string') return handler.start();
    if (!callbacks.length) return handler.show(path);
    const test = path === '*' ? (p) => ({ path: p, params: {} }) : match(path, { decode: decodeURIComponent });
    for (const callback of callbacks) {
      if (typeof callback === 'function') routes.push({ path, test, callback });
    }
    return handler;
  }

  /**
   * Run the callbacks of every route matching `path`, in order, each passing
   * on with `next()`.
   * @param {string} path
   * @returns {Promise<Object>} The context: `{ path, pathname, querystring, params }`.
   */
  handler.show = async function show (path) {
    const [pathname, querystring = ''] = String(path || '/').split('?');
    const ctx = { path, pathname, querystring, params: {} };
    const matching = routes.map((route) => ({ route, found: route.test(pathname) })).filter((m) => m.found);
    let index = 0;
    const next = async () => {
      const entry = matching[index++];
      if (!entry) return;
      ctx.params = Object.assign({}, entry.found.params);
      await entry.route.callback(ctx, next);
    };
    await next();
    return ctx;
  };

  /**
   * Dispatch the current location and every `popstate` after it.
   * @returns {Function} The handler.
   */
  handler.start = function start () {
    if (typeof window === 'undefined' || !window.location) return handler;
    const current = () => window.location.pathname + window.location.search;
    if (!handler._started) {
      window.addEventListener('popstate', () => { handler.show(current()); });
      handler._started = true;
    }
    handler.show(current());
    return handler;
  };

  handler.routes = routes;
  return handler;
}

const shared = createPageRouter();

module.exports = { createPageRouter, page: shared };
