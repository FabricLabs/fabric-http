# `@fabric/http`
![Project Status](https://img.shields.io/badge/status-experimental-rainbow.svg?style=flat-square)
[![Build Status](https://img.shields.io/travis/FabricLabs/web.svg?branch=master&style=flat-square)](https://travis-ci.org/FabricLabs/web)
[![Coverage Status](https://img.shields.io/codecov/c/github/FabricLabs/web.svg?style=flat-square)](https://codecov.io/gh/FabricLabs/web)
[![GitHub contributors](https://img.shields.io/github/contributors/FabricLabs/web.svg?style=flat-square)](https://github.com/FabricLabs/web/graphs/contributors)
[![Community](https://img.shields.io/matrix/hub:fabric.pub.svg?style=flat-square)](https://chat.fabric.pub)

Fabric module for serving the legacy web.

## Quick Start
Building applications with `@fabric/http` is easy.

```
mkdir myapp && cd myapp
npm init
npm i --save @fabric/http
```

Create an application by creating a new file (here we've used `scripts/app.js`), containing the following:
### `scripts/app.js`:
```js
'use strict';

const SPA = require('@fabric/http/types/spa');

async function main () {
  const spa = new SPA({
    name: 'Example App',
    synopsis: 'Simple demonstration of a single-page app.',
    resources: {
      'Todo': {
        description: 'A to-do list item.'
      }
    }
  });

  await spa.start();
}

main().catch((exception) => {
  console.log('[FABRIC-HTTP:EXAMPLE] Main Process Exception:', exception);
}).then((output) => {
  console.log('[FABRIC-HTTP:EXAMPLE] Main Process Output:', output);
});
```

Run `node scripts/app.js` to start the app, or `webpack scripts/app.js -o assets/app.min.js` to
build a browser version.

### Advanced: `@maki/roller`

## Maki, making beautiful apps a breeze
Try `maki roll examples` in this repo for a mind-blowing experience.
