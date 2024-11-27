# `@fabric/http` — HTTP support for Fabric applications
![Project Status](https://img.shields.io/badge/status-experimental-rainbow.svg?style=flat-square)
[![Coverage Status](https://img.shields.io/codecov/c/github/FabricLabs/web.svg?style=flat-square)](https://codecov.io/gh/FabricLabs/web)
[![GitHub contributors](https://img.shields.io/github/contributors/FabricLabs/web.svg?style=flat-square)](https://github.com/FabricLabs/web/graphs/contributors)
[![Community](https://img.shields.io/matrix/hub:fabric.pub.svg?style=flat-square)](https://chat.fabric.pub)

Robust library for implementing Fabric-enabled Web Applications.

## What is Fabric?
[Fabric][fabric] is an attempt at replicating the World Wide Web ("the WWW") as a peer-to-peer network, using payment relationships to exchange documents and scale the network.  `@fabric/http` provides a framework for hosting Fabric-enabled applications over HTTP, allowing them to be used as "edge servers" for legacy web users.

## Quick Start
Building applications with `@fabric/http` is easy.

```sh
mkdir some-project && cd some-project
npm init # Initialize the project
npm i --save @fabric/http # Install the @fabric/http dependency
```

Create an application by creating a new file (here we've used `scripts/node.js`), containing the following:
### `scripts/node.js`:
```js
'use strict';

// Dependencies
const SPA = require('@fabric/http/types/spa');

// Main Process
async function main () {
  const spa = new SPA({
    name: 'Example Application',
    synopsis: 'Simple demonstration of a single-page application.',
    resources: {
      'Todo': {
        description: 'A to-do list item.'
      }
    }
  });

  // Start the Process
  await spa.start();

  // Return reference
  return { id: spa.id };
}

main().catch((exception) => {
  console.log('[FABRIC-HTTP:EXAMPLE] Main Process Exception:', exception);
}).then((output) => {
  console.log('[FABRIC-HTTP:EXAMPLE] Main Process Output:', output);
});
```

Run `node scripts/node.js` to start the app, or `webpack scripts/app.js -o assets/app.min.js` to
build a browser version.

[fabric]: https://fabric.pub
