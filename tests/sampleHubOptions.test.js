'use strict';

const assert = require('assert');
const { SAMPLE_HUB_HTTP_SERVER_NAME } = require('../constants');
const { isSampleHubHttpServerOptions } = require('../sampleHubOptions');

describe('sampleHubOptions', function () {
  it('isSampleHubHttpServerOptions matches only the sample name', function () {
    assert.strictEqual(isSampleHubHttpServerOptions(null), false);
    assert.strictEqual(isSampleHubHttpServerOptions({ name: 'hub.fabric.pub' }), false);
    assert.strictEqual(
      isSampleHubHttpServerOptions({ name: SAMPLE_HUB_HTTP_SERVER_NAME }),
      true
    );
  });
});
