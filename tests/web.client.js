'use strict';

const assert = require('assert');

// Web Client
const HTTPClient = require('../types/client');
const HTTPServer = require('../types/server');

const TEST_HOST = 'example.com';
const TEST_AUTHORITY = 'localhost';
const TEST_CONFIG = {
  authority: TEST_AUTHORITY,
  secure: false,
  port: 9999
};

const authority = new HTTPServer(TEST_CONFIG);

describe('@fabric/web/types/client', function () {
  before(function () {
    return authority.start();
  });

  after(function () {
    return authority.stop();
  });

  describe('Client', function () {
    it('should expose a constructor', function () {
      assert.equal(typeof HTTPClient, 'function');
    });

    it('can retrieve content from a local server', async function () {
      let client = new HTTPClient(TEST_CONFIG);
      let result = await client._GET('/');
      // TODO: test result contents
      // console.log('result:', result.toString());
      assert.ok(result);
    });

    it('can post content to a local server', async function () {
      let client = new HTTPClient(TEST_CONFIG);
      let before = await client._GET('/examples');
      let result = await client._POST('/examples', { id: 'test', foo: 'bar' });
      let after = await client._GET('/examples');
      // TODO: fix cleanup
      // assert.deepEqual(before, []);
      // assert.deepEqual(after, [{ id: 'test', foo: 'bar' }]);
      assert.ok(result);
    });

    xit('can create content on a local server', async function () {
      let client = new HTTPClient(TEST_CONFIG);
      let before = await client._GET('/examples/test');
      let result = await client._PUT('/examples/test', { id: 'test', foo: 'qux' });
      let after = await client._GET('/examples/test');
      // TODO: fix cleanup
      // assert.deepEqual(before, {});
      assert.deepEqual(after, { id: 'test', foo: 'qux' });
      assert.ok(result);
    });

    xit('can update content on a local server', async function () {
      let client = new HTTPClient(TEST_CONFIG);
      let before = await client._GET('/examples/test');
      let result = await client._PATCH('/examples/test', { foo: 'baz' });
      let after = await client._GET('/examples/test');
      assert.deepEqual(before, { id: 'test', foo: 'qux' });
      assert.deepEqual(after, { id: 'test', foo: 'baz' });
      assert.ok(result);
    });

    xit('can delete content on a local server', async function () {
      let client = new HTTPClient(TEST_CONFIG);
      let before = await client._GET('/examples/test');
      let result = await client._DELETE('/examples/test');
      let after = await client._GET('/examples/test');
      assert.deepEqual(before, { id: 'test', foo: 'baz' });
      assert.deepEqual(after, {});
      assert.equal(result, null);
    });

    xit('can retrieve content from the legacy web', async function () {
      let client = new HTTPClient({ authority: TEST_HOST, secure: false });
      let result = await client._GET('/');
      assert.ok(result);
    });

    xit('can post content to the legacy web', async function () {
      let client = new HTTPClient({ authority: TEST_HOST, secure: false });
      let result = await client._POST('/examples', {
        id: 'test',
        foo: 'bar'
      });
      assert.ok(result);
    });

    xit('can create content on the legacy web', async function () {
      let client = new HTTPClient({ authority: TEST_HOST, secure: false });
      let result = await client._PUT('/examples/test', {
        id: 'test',
        foo: 'qux'
      });
      assert.ok(result);
    });

    xit('can update content on the legacy web', async function () {
      let client = new HTTPClient({ authority: TEST_HOST, secure: false });
      let result = await client._PATCH('/examples/test', {
        foo: 'baz'
      });
      assert.ok(result);
    });

    xit('can delete content on the legacy web', async function () {
      let client = new HTTPClient({ authority: TEST_HOST, secure: false });
      let result = await client._DELETE('/examples/test');
      assert.ok(result);
    });

    xit('can crawl an HTML page', async function () {
      let client = new HTTPClient({ authority: TEST_HOST, secure: false });
      let result = await client.crawl(`http://${TEST_HOST}`);
      assert.ok(result);
      assert.ok(result.metadata);
      assert.ok(result.content);
    });
  });
});
