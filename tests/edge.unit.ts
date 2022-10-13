'use strict';

const fixtures = require('@fabric/core/fixtures');
const config = require('../settings/test');

import { EdgeNode } from '../types/edge';

// Testing
const assert = require('assert');

describe('@fabric/http/types/edge', function () {
  describe('Edge', function () {
    it('should expose a constructor', function () {
      assert.equal(EdgeNode instanceof Function, true);
    });

    it('create an instance', function () {
      const node = new EdgeNode();
      assert.equal(EdgeNode instanceof Function, true);
      assert.ok(node);
    });
  });
});
