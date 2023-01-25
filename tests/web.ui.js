'use strict';

const fixtures = require('@fabric/core/fixtures');
const config = require('../settings/test');

const UI = require('../types/ui');

// Testing
const assert = require('assert');

describe('@fabric/http/types/ui', function () {
  describe('UI', function () {
    it('should expose a constructor', function () {
      assert.equal(UI instanceof Function, true);
    });

    it('create an instance', function () {
      const node = new UI();
      assert.equal(UI instanceof Function, true);
      assert.ok(node);
    });
  });
});
