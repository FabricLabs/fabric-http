# @fabric/http examples

Offline tutorials for the HTTP edge. They do not call `HTTPServer#start`.

```bash
npm run example:tutorials
```

| Script | What it shows |
|--------|----------------|
| [passport-relying-party.js](passport-relying-party.js) | Pinned origin, redeem once, session view |
| [message-bridge.js](message-bridge.js) | JSON in, typed fields out |
| [delegation-body.js](delegation-body.js) | A `fabric:` grant in a request body, and a rate limit |

The stack map, including the core scripts and the scroll-driven walkthroughs, lives in the `@fabric/core` checkout at `examples/TUTORIALS.md`. On this machine that checkout is the sibling `fabric-clean` repository.

`server.js`, `app.js`, and `build.js` stay as they are. `server.js` listens.
