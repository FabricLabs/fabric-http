# Fabric over WebRTC vs `@fabric/http`

`FabricHTTPServer` is responsible for **HTTP** (static, JSON-RPC, optional 402) and **WebSocket** connections on one port. **WebRTC** (native `RTCPeerConnection` + `RTCDataChannel`) is **not** set up by this package alone; production stacks use a hub **Bridge** for signaling and the same `Message` binary as WebSocket where possible.

## What this server provides

- **`this.webrtcPeers`**: a registry map for lightweight tracking.
- **JSON-RPC methods** (when JSON-RPC is enabled) on the same surface as WebSocket `JSONCall`:

  - `RegisterWebRTCPeer` — body `{ "id" | "peerId", "label"?, "meta" | "metadata"? }` — upserts a browser peer in `webrtcPeers` (configurable `settings.webrtc` limits: max peers, id/label lengths, max JSON size for `meta`/`metadata`). Returns `{ ok, id, total, secret }`; **keep `secret`** and send it in **`UnregisterWebRTCPeer`** so one client cannot remove another’s registration without the latest secret from register.
  - `UnregisterWebRTCPeer` — `{ "id" | "peerId", "secret" }` — unregisters when `secret` matches the one from the most recent register for that id.
  - `ListWebRTCPeers` — returns `{ ok, peers: [...] }` (no secrets in `peers`).

These exist so **dev tools and browser extensions** can align with a single RPC namespace before an app's own signaling is in use.

### Security defaults (production-oriented)

- `settings.webrtc.requireTransportAuth` defaults to **true**.
- WebRTC registry RPC methods (`RegisterWebRTCPeer`, `UnregisterWebRTCPeer`, `ListWebRTCPeers`) require an authorized transport context.
- Existing peer IDs cannot be overwritten without the current peer `secret`; unregister also requires `secret`.
- WebSocket subscriptions to resource paths that require read auth are denied for unauthorized sockets.
- Protected resource updates are not broadcast to unauthorized WebSocket subscribers.
- WebSocket `POST` / `PATCH` resource writes are gated by the same resource/global auth policies used by HTTP routing.

## Message ↔ JSON at the HTTP edge

`@fabric/http` exports [`functions/messageBodyJsonBridge`](../functions/messageBodyJsonBridge.js) (`require('@fabric/http/functions/messageBodyJsonBridge')`) for Message field-body ↔ plain JSON (REST / SPA). That helper is shared by hub Bridges and other HTTP consumers; it does **not** implement WebRTC mesh signaling by itself. The app's Bridge remains the signaling authority for browser peers.

## What lives downstream

- **Browser extensions** hold the **signaling URL** and `RTCPeerConnection` construction; they are wired toward a hub WebSocket, not the bare `fabric-http` static server.
- **Hubs**: authoritative **Bridge** + JSON-RPC for full WebRTC + identity flows.

## Local hub-shaped stub (localhost, extension-friendly)

For the same static + JSON-RPC surface without a full hub stack, this repo provides:

- `npm run sample:hub` — `FabricHTTPServer` on **127.0.0.1:8099** by default (override `PORT` / `HOST`; `PORT=8080` only if no other hub uses 8080), `cors: true`, `POST /services/rpc` with a trivial `HubStubPing` method, and `examples/hub-local-dev-assets/hub-mesh-bridge.html` (same `postMessage` contract as a hub page, for an extension's background mesh). For extension checks, point the UI at the sample origin or at a full hub on `http://localhost:8080`.

- **CORS / preflight:** When `settings.cors` is true, `OPTIONS` to each configured JSON-RPC path (e.g. `/services/rpc`) returns **204** so browser `fetch` with `Authorization` from an extension or another origin can complete the preflight (see `tests/web.server.js`).

- Stricter auth for local tests: set `FABRIC_JSONRPC_REQUIRE_AUTH=1` and `FABRIC_HTTP_TOKEN_SECRET=…` (bearer via `middlewares/auth.js`).

## “Finalize” checklist

- [ ] Downstream browser E2E: offer/answer and data channel with `Message.toBuffer()`.
- [ ] Optional: proxy signaling through `fabric-http` (only if a no-hub path is required).

## See also

- [MESSAGE_SPEC.md](./MESSAGE_SPEC.md)
- `README.md` (Peering / WebRTC pointer)
- WebRTC signaling itself is Hub's Bridge, not a core document.
