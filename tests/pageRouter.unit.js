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

  it('stops when a callback does not call next', async function () {
    const router = createPageRouter();
    const seen = [];
    router('/', () => seen.push('home'));
    router('*', () => seen.push('any'));
    await router('/');
    assert.deepStrictEqual(seen, ['home']);
  });

  it('is one shared registry for SPA and App', function () {
    const SPA = require('../types/spa');
    const App = require('../types/app');
    assert.strictEqual(Object.getOwnPropertyDescriptor(SPA.prototype, 'handler').get.call({}), page);
    assert.strictEqual(Object.getOwnPropertyDescriptor(App.prototype, 'handler').get.call({}), page);
  });
});
