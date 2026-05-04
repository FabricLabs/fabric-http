'use strict';

const assert = require('assert');
const { SAMPLE_HUB_HTTP_SERVER_NAME, DEFAULT_SAMPLE_HUB_HTTP_PORT } = require('../constants');

describe('constants (sample hub literals)', function () {
  it('exposes sample server name and default port', function () {
    assert.strictEqual(typeof SAMPLE_HUB_HTTP_SERVER_NAME, 'string');
    assert(SAMPLE_HUB_HTTP_SERVER_NAME.length > 0);
    assert.strictEqual(typeof DEFAULT_SAMPLE_HUB_HTTP_PORT, 'number');
    assert(DEFAULT_SAMPLE_HUB_HTTP_PORT > 0);
  });
});
