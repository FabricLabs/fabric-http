'use strict';

const assert = require('assert');
const { createPageRouter, page } = require('../functions/pageRouter');

describe('functions/pageRouter', function () {
  it('runs the callbacks of matching routes in order, with params', async function () {
    const router = createPageRouter();
    const seen = [];
    router('/things', (ctx) => seen.push(['list', ctx.pathname]));
    router('/things/:id', (ctx, next) => { seen.push(['view', ctx.params.id]); return next(); });
    router('*', (ctx) => seen.push(['any', ctx.querystring]));

    const ctx = await router.show('/things/a%20b?x=1');
    assert.deepStrictEqual(seen, [['view', 'a b'], ['any', 'x=1']]);
    assert.strictEqual(ctx.path, '/things/a%20b?x=1');
  });

  it('a query string does not stop a route lookup', function () {
    const Router = require('../types/router');
    const Browser = require('../types/browser');
    const router = new Router({});
    router._addRoute('/widgets', 'widget-list');
    const found = Browser.prototype.route.call({ router }, '/widgets?sort=new');
    assert.strictEqual(found.route.component, 'widget-list');
  });

  it('SPA.define keeps state under the resource\'s own route', function () {
    const SPA = require('../types/spa');
    const spa = new SPA({});
    spa.define('Widget', { components: {} });
    assert.ok(Object.prototype.hasOwnProperty.call(spa._state.content, 'widgets'));
    assert.ok(!Object.prototype.hasOwnProperty.call(spa._state.content, 'radicals'));
  });

  it('SPA.define keeps the resource\'s own data', function () {
    const SPA = require('../types/spa');
    const spa = new SPA({});
    const data = [{ id: 'a' }, { id: 'b' }];
    spa.define('Widget', { components: {}, data });
    assert.deepStrictEqual(spa._state.content.widgets, data);
  });

  it('SPA answers a binary P2P_PING with a pong', async function () {
    const SPA = require('../types/spa');
    const Message = require('@fabric/core/types/message');
    const spa = new SPA({});
    const sent = [];
    spa.bridge = { send: (buffer) => sent.push(buffer) };
    const ping = Message.fromBuffer(Message.fromLegacyBody('P2P_PING', { nonce: '1' }).toBuffer());
    assert.strictEqual(ping.type, 'P2P_PING');
    await spa._handleBridgeMessage(ping);
    assert.strictEqual(sent.length, 1);
    assert.strictEqual(Message.fromBuffer(sent[0]).type, 'P2P_PONG');
    await spa._handleBridgeMessage(Message.fromBuffer(sent[0]));
    assert.strictEqual(sent.length, 1, 'a pong is not answered');
  });

  it('Browser#load reads state at the pathname, not the query string', async function () {
    const Router = require('../types/router');
    const Browser = require('../types/browser');
    const saved = global.document;
    global.document = { createElement: (tag) => ({ tagName: tag }) };
    try {
      const router = new Router({});
      router._addRoute('/widgets', 'widget-list');
      const asked = [];
      let shown = null;
      const fake = {
        router,
        route: Browser.prototype.route,
        _GET: async (path) => { asked.push(path); return path === '/widgets' ? ['w'] : null; },
        _setElement: (element) => { shown = element; }
      };
      Browser.prototype.load.call(fake, '/widgets?sort=new#top');
      await new Promise((resolve) => setImmediate(resolve));
      assert.deepStrictEqual(asked, ['/widgets']);
      assert.deepStrictEqual(shown.state, { widgets: ['w'] });
    } finally {
      global.document = saved;
    }
  });

  it('App navigation passes on when no browser route matches', async function () {
    const App = require('../types/app');
    let passed = false;
    await App.prototype._handleNavigation.call({ browser: { route: async () => null } }, { path: '/nowhere' }, () => { passed = true; });
    assert.strictEqual(passed, true);
  });

  it('stops when a callback does not call next', async function () {
    const router = createPageRouter();
    const seen = [];
    router('/', () => seen.push('home'));
    router('*', () => seen.push('any'));
    await router('/');
    assert.deepStrictEqual(seen, ['home']);
  });

  it('routes same-origin link clicks through the router, and leaves the rest to the browser', async function () {
    const listeners = {};
    const pushed = [];
    const saved = { window: global.window, document: global.document };
    global.window = {
      location: { pathname: '/', search: '', href: 'https://app.test/', origin: 'https://app.test' },
      history: { pushState: (_s, _t, path) => pushed.push(path) },
      addEventListener: () => {}
    };
    global.document = { addEventListener: (type, fn) => { listeners[type] = fn; } };
    try {
      const router = createPageRouter();
      const seen = [];
      router('/things/:id', (ctx) => seen.push(ctx.params.id));
      router.start();
      const link = (href, attrs = {}) => ({
        nodeName: 'A',
        href: new URL(href, 'https://app.test/').href,
        getAttribute: (name) => (name === 'href' ? href : (attrs[name] == null ? null : attrs[name])),
        hasAttribute: (name) => attrs[name] != null
      });
      const click = (target, extra = {}) => {
        const event = Object.assign({ button: 0, target, defaultPrevented: false, preventDefault () { this.defaultPrevented = true; } }, extra);
        listeners.click(event);
        return event.defaultPrevented;
      };
      assert.strictEqual(click(link('/things/a')), true);
      assert.strictEqual(click(link('/things/b'), { metaKey: true }), false);
      assert.strictEqual(click(link('/things/c', { target: '_blank' })), false);
      assert.strictEqual(click(link('/things/d', { download: '' })), false);
      assert.strictEqual(click(link('https://elsewhere.test/things/e')), false);
      assert.strictEqual(click(link('/unrouted')), false);
      assert.strictEqual(click({ nodeName: 'SPAN', parentNode: link('/things/f') }), true);
      await new Promise((resolve) => setImmediate(resolve));
      assert.deepStrictEqual(pushed, ['/things/a', '/things/f']);
      assert.deepStrictEqual(seen, ['a', 'f']);
    } finally {
      global.window = saved.window;
      global.document = saved.document;
    }
  });

  it('is one shared registry for SPA and App', function () {
    const SPA = require('../types/spa');
    const App = require('../types/app');
    assert.strictEqual(Object.getOwnPropertyDescriptor(SPA.prototype, 'handler').get.call({}), page);
    assert.strictEqual(Object.getOwnPropertyDescriptor(App.prototype, 'handler').get.call({}), page);
  });
});
