'use strict';

const assert = require('assert');
const Router = require('../types/router');

describe('@fabric/web/types/router', function () {
  describe('Router', function () {
    it('should expose a constructor', function () {
      assert.equal(typeof Router, 'function');
    });

    it('can start and stop smoothly', async function () {
      const router = new Router();
      await router.start();
      await router.stop();
      assert.ok(router);
    });
  });
});
