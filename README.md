# `@fabric/http`
Fabric module for serving the legacy web.

## Quick Start
Building applications with `@fabric/http` is easy.

```
mkdir myapp && cd myapp
npm install @fabric/http
```

### `app.js`
```js
'use strict';

const SPA = require('@fabric/http/types/spa');

async function main () {
  let spa = new SPA(
    name: 'Example App',
    synopsis: 'Simple demonstration of a single-page app.',
    resources: {
      'Todo': {
        description: 'A to-do list item.'
      }
    }
  );

  await spa.start();
}

main();
```

Run `node app.js` to start the app, or `webpack app.js -o assets/app.min.js` to
build a browser version.

### Advanced: `@maki/roller`

## Maki, making beautiful apps a breeze
Try `maki roll examples` in this repo for a mind-blowing experience.
