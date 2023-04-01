'use strict';

// Dependencies
const assert = require('assert');

// Web Client
const Remote = require('../types/remote');

const TEST_HOST = 'example.com';
const TEST_CONFIG = require('../settings/test');

describe('@fabric/http/types/remote', function () {
  describe('Remote', function () {
    it('should expose a constructor', function () {
      assert.equal(typeof Remote, 'function');
    });
  });
});
