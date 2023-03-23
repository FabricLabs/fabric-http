# Build `@fabric/http`
The Fabric HTTP library exists to serve Fabric applications to the legacy web.

We generate `assets/bundles/browser.js` from `scripts/browser.js` using the Fabric HTTP Compiler.

## Quick Start
`npm run build` will run the build.  This will generate `assets/bundles/browser.js` — the primary browser bundle for using `@fabric/http` in downstream applications.

## The Fabric Compiler
Importing `@fabric/http/types/compiler` will enable generation of HTML-encoded single-page applications:
```js
const Compiler = require('@fabric/http/types/compiler');
const compiler = new Compiler();

compiler.compileTo('example.html');
```

## Maintenance
Use `npm run reports` to generate a full pre-production build.  This will update any dependencies allowed by `package.json` but should ideally be none as all versions are pinned.

## Notes
Currently, a small number of packages seem to occasionally update sub-packages in `package-lock.json` but we are seeking to prune them out.  Consider submitting a Pull Request!
