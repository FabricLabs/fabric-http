# Release gate: downstream auth

Apps that call `@fabric/http` JSON-RPC with a bearer (browser extensions, web clients) should gate their releases on an end-to-end auth test of the shape below. Those suites live in the apps, not in this repo.

## What `@fabric/http` provides

- JSON-RPC and WebSocket can require a **bearer** (`middlewares/auth.js`) and a **WebSocket** client token (`settings.websocket`) consistent with the HTTP JSON-RPC policy (`jsonRpc.requireAuth`). See `tests/security.auth.server.js`.
- **CORS:** With `cors: true`, `OPTIONS` on each JSON-RPC path returns **204** so extension or web `fetch` preflights succeed (`tests/web.server.js`). A minimal hub-shaped static + RPC dev server is **`npm run sample:hub`** (default `http://127.0.0.1:8099`, `hub-mesh-bridge.html`); see `docs/WEBRTC_FABRIC_HTTP.md`.

## Suggested test shape

1. Start a small HTTP server (or `tests/helpers` harness) with `jsonRpc: { enabled: true, requireAuth: true, paths: ['/services/rpc'] }` and a known `tokenSecret` / seed.
2. Build a **valid** bearer with **`buildBearerToken(secret, payload)`** from `middlewares/auth` (same as `verifyBearerToken`).
3. `POST /services/rpc` with `Authorization: Bearer <token>` and a trivial method (e.g. `ReleaseGatePing`); expect **200** and JSON-RPC result.
4. Optional: same secret as WebSocket `?clientToken=` for JSON-RPC over WS (see `tests/web.server.ws.jsoncall.js` patterns).

Keep JSON-RPC auth **off** in the app's default UI suite and turn it on only for this test (e.g. behind an env flag), so other UI tests are unchanged.

## Related files

`tests/security.auth.server.js`, `middlewares/auth.js`, `types/server.js` (`_isJsonRpcTransportAuthorized`).
