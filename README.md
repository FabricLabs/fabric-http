# `@fabric/http` — HTTP support for Fabric applications
![Project Status](https://img.shields.io/badge/status-experimental-rainbow.svg?style=flat-square)
[![Coverage Status](https://img.shields.io/codecov/c/github/FabricLabs/web.svg?style=flat-square)](https://codecov.io/gh/FabricLabs/web)
[![GitHub contributors](https://img.shields.io/github/contributors/FabricLabs/web.svg?style=flat-square)](https://github.com/FabricLabs/web/graphs/contributors)

**Status:** `0.1.0-RC1` — run **`npm run ci`** before release tags (tests + script build).

| Doc | Purpose |
|-----|---------|
| [docs/PRODUCTION.md](docs/PRODUCTION.md) | Deploy, TLS, WebSocket, versioning |
| [docs/MARKETING_OVERVIEW.md](docs/MARKETING_OVERVIEW.md) | Positioning & ecosystem copy |
| [docs/RELEASE_CHECKLIST.md](docs/RELEASE_CHECKLIST.md) | Tag & publish steps |
| [docs/MESSAGE_SPEC.md](docs/MESSAGE_SPEC.md) | `Message` types & `JSONCall` on the WebSocket server |
| [docs/WEBRTC_FABRIC_HTTP.md](docs/WEBRTC_FABRIC_HTTP.md) | WebRTC vs this server; Hub/extension |
| [docs/RELEASE_GATE.md](docs/RELEASE_GATE.md) | Downstream extension auth test gate |
| [middlewares/auth](middlewares/auth.js) | `buildBearerToken` / `verifyBearerToken` (Fabric `Token` + shared secret) |
| [constants.js](constants.js) | Ports, header names, sample-hub string literals (no functions; use `Server` statics in `types/server.js`) |
| [CHANGELOG.md](CHANGELOG.md) | Release notes |

**WebSockets (general pass / PR #54 goals):**

| Improvement | In this package |
|-------------|-----------------|
| **HTTP 402** | [x] `settings.payments` + [middlewares/payments.js](middlewares/payments.js) (problem JSON, opt-in); tests: `tests/payments.http.test.js`. Deeper “finalize” = app-specific payment / settlement hooks. |
| **Fabric + WebRTC** | [x] Registry + JSON-RPC methods + [docs/WEBRTC_FABRIC_HTTP.md](docs/WEBRTC_FABRIC_HTTP.md). [ ] Full Hub + extension E2E (offer/answer, `Message` on data channel) stays on Hub/extension tracks. |
| **`Message` spec** | [x] [docs/MESSAGE_SPEC.md](docs/MESSAGE_SPEC.md) (WebSocket contract; wire format in `@fabric/core`). |
| **Release gate** | [x] `@fabric/passport`: bearer + `POST /services/rpc` — [docs/RELEASE_GATE.md](docs/RELEASE_GATE.md), `npm run test:ui:release-gate`. [ ] `@fabric/browser` when that package has a matching E2E harness. |

**Peering / WebRTC:** Browser signaling is **native WebRTC** (Hub **`Bridge`** + JSON-RPC), not Fabric TCP **`P2P_SESSION_OFFER`/`OPEN`**. Phase alignment with the CLI mental model lives in **`@fabric/core`**: [`docs/SESSION_AND_WEBRTC.md`](https://github.com/FabricLabs/fabric/blob/develop/docs/SESSION_AND_WEBRTC.md) (use the path in your pinned core checkout).

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

From a clone of **this** repository:

```sh
npm ci
npm run ci   # tests + build:scripts — use before tags / CI
```

### `fabric-http` CLI (http-server–style)
The `fabric-http` binary serves a directory with Express static middleware (correct `Content-Type`, caching, `ETag`, dotfile hiding) plus Fabric services (WebSocket `/`, JSON-RPC when enabled, peering/WebRTC signaling via the **Hub** rather than legacy PeerJS, etc.). Treat it like [`http-server`](https://www.npmjs.com/package/http-server) for the filesystem, with extra endpoints.

```sh
npx fabric-http ./dist -p 8080 -a 0.0.0.0
# cache static assets for one hour (seconds, like http-server -c)
npx fabric-http ./assets -c 3600
# client-side routing: serve index.html when no matching file exists
npx fabric-http ./build --spa
```

Programmatic options on `new HTTPServer({ ... })` include `assets` (or `path` alias for the static root), `static: { cacheSeconds, ... }`, `spaFallback`, `jsonRpc: { enabled, paths }`, `cors`, and `compression`. HTTP JSON-RPC (`POST /rpc`) uses the same `_handleCall` surface as WebSocket `JSONCall` when `jsonRpc.enabled` is true (e.g. hub.fabric.pub). For a small Hub-shaped dev server (default **8099** so it does not steal **8080** from a real @fabric/hub, CORS, `POST /services/rpc`, `hub-mesh-bridge.html` for the extension), use **`npm run sample:hub`** (see [docs/WEBRTC_FABRIC_HTTP.md](docs/WEBRTC_FABRIC_HTTP.md)). Set `PORT=8080` only when you are not running hub.fabric.pub on the same machine.

### Deterministic avatars (`types/avatar`)
`@fabric/http` includes a deterministic, Gravatar-like `Avatar` class with a Fabric-themed palette and an academic visual-hash approach inspired by "drunken bishop" / marching-bishop algorithms:

```js
const Avatar = require('@fabric/http/types/avatar');
const avatar = new Avatar('alice@example.edu', { size: 96 });
const svg = avatar.toSVG();
const dataURI = avatar.toDataURI();
const imgHTML = avatar.render(); // <img class="fabric-avatar" ...>
const ascii = avatar.toASCII(); // terminal-friendly visual hash
```

The same input always yields the same SVG; different identities produce different board walks.

For browser custom-elements, `@fabric/http` also exposes `FabricAvatar` on `types/web`:

```js
const { FabricAvatar } = require('@fabric/http');
customElements.define('fabric-avatar', FabricAvatar);
```

### Standards & compliance tests
[`tests/standards.http.js`](tests/standards.http.js) covers RFC 6902 JSON Patch (`fast-json-patch`), JSON Schema checks for JSON-RPC 2.0 bodies ([`tests/schemas/jsonrpc.js`](tests/schemas/jsonrpc.js), [AJV](https://ajv.js.org/) as a devDependency), HTML5-shaped responses with [`jsdom`](https://github.com/jsdom/jsdom) ([`tests/helpers/htmlCompliance.js`](tests/helpers/htmlCompliance.js)), `Accept` / `formatResponse` negotiation, static files, `POST /rpc`, and `OPTIONS /`. Run: `npx mocha tests/standards.http.js --exit`.

### Developing against a local `@fabric/core`
When `@fabric/core` is cloned alongside this repo, install it so Message types (e.g. `P2P_MESSAGE_RECEIPT`) and HTTP behavior stay aligned:

```sh
npm install ../fabric --no-save
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
