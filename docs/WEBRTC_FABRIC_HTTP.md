# Fabric over WebRTC vs `@fabric/http`

`FabricHTTPServer` is responsible for **HTTP** (static, JSON-RPC, optional 402) and **WebSocket** connections on one port. **WebRTC** (native `RTCPeerConnection` + `RTCDataChannel`) is **not** set up by this package alone; production stacks use the **Hub** (`hub.fabric.pub`) **Bridge** for signaling and the same `Message` binary as WebSocket where possible.

## What this server provides

- **`this.webrtcPeers`**: a registry map for lightweight tracking.
- **JSON-RPC methods** (when JSON-RPC is enabled) on the same surface as WebSocket `JSONCall`:

  - `RegisterWebRTCPeer` — body `{ "id" | "peerId", "label"?, "meta" | "metadata"? }` — upserts a browser peer in `webrtcPeers` (configurable `settings.webrtc` limits: max peers, id/label lengths, max JSON size for `meta`/`metadata`). Returns `{ ok, id, total, secret }`; **keep `secret`** and send it in **`UnregisterWebRTCPeer`** so one client cannot remove another’s registration without the latest secret from register.
  - `UnregisterWebRTCPeer` — `{ "id" | "peerId", "secret" }` — unregisters when `secret` matches the one from the most recent register for that id.
  - `ListWebRTCPeers` — returns `{ ok, peers: [...] }` (no secrets in `peers`).

These exist so **dev tools and the extension** can align with a single RPC namespace before Hub-specific signaling is in use.

## What lives downstream

- **Extension** (`@fabric/passport`): `src/fabric/fabricWebRTCPeering.ts` and the offscreen mesh helpers hold **signaling URL** and `RTCPeerConnection` construction; they are wired toward Hub WebSocket, not the bare `fabric-http` static server.
- **Hub**: authoritative **Bridge** + JSON-RPC; see that repo for full WebRTC + identity flows.

## Local Hub-shaped stub (localhost, extension-friendly)

For the same static + JSON-RPC surface without the full **@fabric/hub** stack, this repo provides:

- `npm run sample:hub` — `FabricHTTPServer` on **127.0.0.1:8099** by default (override `PORT` / `HOST`; `PORT=8080` only if you are not also running a real Hub on 8080), `cors: true`, `POST /services/rpc` with a trivial `HubStubPing` method, and `examples/hub-local-dev-assets/hub-mesh-bridge.html` (same `postMessage` contract as a Hub page for **@fabric/passport** background mesh). For extension checks, point the UI at the sample origin or at a real Hub on `http://localhost:8080`.

- **CORS / preflight:** When `settings.cors` is true, `OPTIONS` to each configured JSON-RPC path (e.g. `/services/rpc`) returns **204** so browser `fetch` with `Authorization` from an extension or another origin can complete the preflight (see `tests/jsonrpc.cors.preflight.js`).

- Stricter auth for local tests: set `FABRIC_JSONRPC_REQUIRE_AUTH=1` and `FABRIC_HTTP_TOKEN_SECRET=…` (bearer via `middlewares/auth.js`).

- **@fabric/passport (extension):** With this server up, in the extension repo run **`npm run test:ui:mesh-remote`** (or set `FABRIC_HUB_BASE_URL` yourself) to exercise the mesh bridge on this origin; see the extension `README` “Remote Hub (localhost:8080) mesh integration”.

## “Finalize” checklist

- [ ] Hub + extension E2E: offer/answer and data channel with `Message.toBuffer()`.
- [ ] Optional: proxy signaling through `fabric-http` (only if product requires a no-Hub path).

## See also

- [MESSAGE_SPEC.md](./MESSAGE_SPEC.md)
- `README.md` (Peering / WebRTC pointer)
- Upstream: [`SESSION_AND_WEBRTC.md`](https://github.com/FabricLabs/fabric/blob/develop/docs/SESSION_AND_WEBRTC.md) in `@fabric/core` (path in your checkout).
