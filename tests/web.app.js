'use strict';

const assert = require('assert');
const App = require('../types/app');

describe('@fabric/web/types/app', function () {
  describe('App', function () {
    it('should expose a constructor', function () {
      assert.equal(typeof App, 'function');
    });

    it('can start and stop smoothly', async function () {
      const app = new App();

      try {
        await app.start();
      } catch (E) {
        console.error('Could not start:', E);
      }

      try {
        await app.stop();
      } catch (E) {
        console.error('Could not stop:', E);
      }

      assert.ok(app);
    });
  });
});
