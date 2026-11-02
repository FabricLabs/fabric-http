'use strict';

/**
 * @fileoverview Client route registry shared by {@link SPA} and {@link App}
 * (`handler`), called like page.js: `handler(path, ...callbacks)`. Paths use
 * path-to-regexp 9 syntax (`/things/:id`); `*` matches every path. Nothing
 * listens to the browser until `start()`.
 */

const { match } = require('path-to-regexp');

/**
 * @returns {Function} `handler(path, ...callbacks)` with `show(path)`, `redirect(path)`, `start()`, and `routes`.
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
   * Push `path` onto history and dispatch it.
   * @param {string} path
   * @returns {Promise<Object>} The context.
   */
  handler.redirect = function redirect (path) {
    if (typeof window !== 'undefined' && window.history && typeof window.history.pushState === 'function') {
      window.history.pushState({}, '', path);
    }
    return handler.show(path);
  };

  /**
   * Dispatch the current location, every `popstate` after it, and clicks on
   * same-origin links to a registered route (not modified clicks, links with
   * a `target` or `download`, or links to another origin or only a hash).
   * @returns {Function} The handler.
   */
  handler.start = function start () {
    if (typeof window === 'undefined' || !window.location) return handler;
    const current = () => window.location.pathname + window.location.search;
    if (!handler._started) {
      window.addEventListener('popstate', () => { handler.show(current()); });
      if (typeof document !== 'undefined' && document && typeof document.addEventListener === 'function') {
        document.addEventListener('click', (event) => {
          const path = linkPath(event);
          if (!path) return;
          event.preventDefault();
          handler.redirect(path);
        });
      }
      handler._started = true;
    }
    handler.show(current());
    return handler;
  };

  /** @private the in-app path an eligible link click goes to, else null */
  function linkPath (event) {
    if (!event || event.defaultPrevented || event.button !== 0) return null;
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return null;
    let el = event.target;
    while (el && String(el.nodeName || '').toUpperCase() !== 'A') el = el.parentNode;
    if (!el || !el.getAttribute || el.getAttribute('href') == null) return null;
    if (el.hasAttribute('download') || (el.getAttribute('target') && el.getAttribute('target') !== '_self')) return null;
    if (String(el.getAttribute('rel') || '').split(/\s+/).includes('external')) return null;
    let url;
    try { url = new URL(el.href, window.location.href); } catch (_) { return null; }
    if (url.origin !== window.location.origin) return null;
    if (url.pathname === window.location.pathname && url.search === window.location.search && url.hash) return null;
    const path = url.pathname + url.search;
    return routes.some((route) => route.path !== '*' && route.test(url.pathname)) ? path : null;
  }

  handler.routes = routes;
  return handler;
}

const shared = createPageRouter();

module.exports = { createPageRouter, page: shared };
