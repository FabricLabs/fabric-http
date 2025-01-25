'use strict';

const fetch = require('cross-fetch');
const { createClient } = require('graphql-http');

const client = createClient({
  url: 'http://localhost:9999/services/graphql',
  fetchFn: fetch
});

async function main () {
  const result = await new Promise((resolve, reject) => {
    const query = '{ state }';
    let result;
    let cancel = client.subscribe({ query }, {
      next: (data) => (result = data),
      error: reject,
      complete: () => resolve(result),
    });
  });

  console.log('result:', result);

  return { result };
}

main().catch((exception) => {
  console.error('error:', exception);
}).then((output) => {
  console.log('output:', output);
});
