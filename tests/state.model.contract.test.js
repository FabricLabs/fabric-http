'use strict';

const assert = require('assert');

const App = require('../types/app');
const SPA = require('../types/spa');

describe('@fabric/http state model contract', function () {
  // Coverage instrumentation can slow SPA bootstrap enough to hit Mocha's 2s default.
  this.timeout(15000);

  it('App stores canonical data under _state.content', function () {
    const app = new App({ resources: {} });
    app.state = { users: { a: 1 } };
    assert.ok(app._state && app._state.content);
    assert.deepStrictEqual(app._state.content, { users: { a: 1 } });
  });

  it('App public state reads are snapshots', function () {
    const app = new App({ resources: {} });
    app.state = { users: { a: 1 } };
    const snapshot = app.state;
    snapshot.users.a = 2;
    assert.strictEqual(app._state.content.users.a, 1);
  });

  it('SPA stores canonical data under _state.content', function () {
    const spa = new SPA({ resources: {} });
    spa.state = { title: 'X', users: {} };
    assert.deepStrictEqual(spa._state.content, { title: 'X', users: {} });
  });

  it('SPA public state reads are snapshots', function () {
    const spa = new SPA({ resources: {} });
    spa.state = { title: 'X', users: { a: 1 } };
    const snapshot = spa.state;
    snapshot.users.a = 2;
    assert.strictEqual(spa._state.content.users.a, 1);
  });
});
