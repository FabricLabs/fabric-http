# Fabric `Message` usage in `@fabric/http`

This document **formalizes** how the `FabricHTTPServer` uses `@fabric/core`’s `Message` type over the **WebSocket** transport. Binary encoding, signing, and opcodes are defined in **`@fabric/core`**; this file is the **server contract** for which outer types the HTTP package handles.

## Transport

- **WebSocket** (`/` on the same port as HTTP): messages are **binary** `Buffer`s produced with `message.toBuffer()` and parsed with `Message.fromBuffer` when possible. Plain JSON is accepted in some code paths and normalized to a `Message` where applicable.
- **WebRTC** does not terminate in `fabric-http` (see [WEBRTC_FABRIC_HTTP.md](./WEBRTC_FABRIC_HTTP.md)). Peers and signaling are expected via **Hub / Bridge**; the same `Message` binary can be used on an `RTCDataChannel` when paired with that signaling.

## WebSocket: outer types handled by the server

| `Message` type (friendly) | Role |
|----------------------------|------|
| `JSONCall` / `JSON_CALL` | JSON-RPC–like call; body is JSON `{ "method", "params" }`. Server replies with a `JSONCall` carrying `JSONCallResult` or an error (see in-tree handler). Gated by `jsonRpc` + transport auth when `jsonRpc.requireAuth` is set. |
| `Ping` / `P2P_PING` | Keepalive; server may respond with `Pong` / `P2P_PONG` (signed when a root key is present). |
| `Pong` / `P2P_PONG` | Resets the socket keepalive timer. |
| `HEARTBEAT` | Ignored (keepalive). |
| `GET`, `POST`, `PATCH` | Legacy paths; implementation-specific. |
| `GenericMessage` | Dispatched to internal handlers / Fabric message pipeline as configured. |

**Receipts:** The server or core stack may emit `P2P_MESSAGE_RECEIPT` (ack) in line with the Hub client.

## `JSONCall` request body (WebSocket)

```json
{
  "method": "MethodName",
  "params": [ … ]
}
```

**Response** (via `JSONCall` body) uses a `JSONCallResult` convention: success and error shapes are covered by `tests/standards.http.js` and `tests/web.server.ws.jsoncall.js` for the HTTP+WS stack you run in CI.

## Authoritative references

- `@fabric/core` `Message` implementation and wire opcodes.
- `functions/fabricMessageTransport.js` in this package for canonical type aliases and normalization helpers.
- `functions/fabricJsonRpcTransport.js` in this package for JSON-RPC / WS JSONCall envelope helpers.
- Top-level package API stays server-first; import advanced helpers from `@fabric/http/functions/*` (or `require('@fabric/http').protocol`).
- Deeper product transport notes: `MESSAGE_PROTOCOL_REPORT.md` (this repo) and Hub `MESSAGE_TRANSPORT.md` where applicable.
- For browser WebRTC + Hub signaling, see [WEBRTC_FABRIC_HTTP.md](./WEBRTC_FABRIC_HTTP.md).

## Versioning

- Treat **type names and JSON call shapes** as part of the public contract for any version tagged **RC** or **stable**.
- Breaking changes to `JSONCall` or default auth behavior should bump semver and be listed in the package changelog / release notes.
