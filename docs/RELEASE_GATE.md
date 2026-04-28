# Release gate: downstream auth

- [x] **`@fabric/passport` (extension):** `npm run test:ui:release-gate` — `buildBearerToken` + `POST /services/rpc` (`ReleaseGatePing`) against the Playwright `local-test-server` when `FABRIC_JSONRPC_AUTH_TEST=1` (default `npm run test:ui` is unchanged).
- [ ] **`@fabric/browser`:** add a parallel auth E2E when that package exposes a test surface (not shipped from this repo).

## What `@fabric/http` provides

- JSON-RPC and WebSocket can require a **bearer** (`middlewares/auth.js`) and a **WebSocket** client token (`settings.websocket`) consistent with the HTTP JSON-RPC policy (`jsonRpc.requireAuth`). See `tests/security.auth.server.js`.
- **CORS:** With `cors: true`, `OPTIONS` on each JSON-RPC path returns **204** so extension or web `fetch` preflights succeed (`tests/jsonrpc.cors.preflight.js`). A minimal Hub-shaped static + RPC dev server is **`npm run sample:hub`** (default `http://127.0.0.1:8099`, `hub-mesh-bridge.html`); see `docs/WEBRTC_FABRIC_HTTP.md`.

## Suggested test shape (extension)

1. Start a small HTTP server (or `tests/helpers` harness) with `jsonRpc: { enabled: true, requireAuth: true, paths: ['/services/rpc'] }` and a known `tokenSecret` / seed.
2. Build a **valid** bearer with **`buildBearerToken(secret, payload)`** from `middlewares/auth` (same as `verifyBearerToken`).
3. `POST /services/rpc` with `Authorization: Bearer <token>` and a trivial method; expect **200** and JSON-RPC result.
4. Optional: same secret as WebSocket `?clientToken=` for JSON-RPC over WS (see `tests/web.server.ws.jsoncall.js` patterns).

The extension runs `scripts/local-test-server.js` with `FABRIC_JSONRPC_AUTH_TEST=1` and registers `ReleaseGatePing` when that env is set. Run `npm run test:ui:release-gate` (after `playwright:install`); the default `npm run test:ui` leaves JSON-RPC auth **off** so other UI tests are unchanged.

## Related files

- `fabric-http`: `tests/security.auth.server.js`, `middlewares/auth.js`, `types/server.js` (`_isJsonRpcTransportAuthorized`).
- `fabric-browser-extension`: `tests/ui/release-gate-fabric-auth.spec.ts`, `tests/helpers/fabricHttpBearerToken.js`, `scripts/local-test-server.js`, `package.json` → `test:ui:release-gate`.
