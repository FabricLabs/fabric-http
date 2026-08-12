# Fabric `Message` usage in `@fabric/http`

This document **formalizes** how the `FabricHTTPServer` uses `@fabric/core`’s `Message` type over the **WebSocket** transport. Binary encoding, signing, and opcodes are defined in **`@fabric/core`**; this file is the **server contract** for which outer types the HTTP package handles.

## Transport

- **WebSocket** (`/` on the same port as HTTP): messages are **binary** `Buffer`s produced with `message.toBuffer()` and parsed with `Message.fromBuffer` when possible. Plain JSON is accepted in some code paths and normalized to a `Message` where applicable.
- **WebRTC** does not terminate in `fabric-http` (see [WEBRTC_FABRIC_HTTP.md](./WEBRTC_FABRIC_HTTP.md)). Peers and signaling are expected via **Hub / Bridge**; the same `Message` binary can be used on an `RTCDataChannel` when paired with that signaling.

### JSON bridge (HTTP edge only)

`@fabric/core` V1 AMP **bodies are typed field layouts**, not JSON (`docs/MESSAGE_BODY.md`).
This package maps fields ↔ JSON for browsers/REST via
[`functions/messageBodyJsonBridge.js`](../functions/messageBodyJsonBridge.js)
(`messageBodyToJson` / `messageFromJsonBody`). When no field schema is registered,
legacy UTF-8 JSON parse (`wireJson`) remains the fallback.

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

**First-class app frames (decoded by `@fabric/core`, dispatched downstream):** `P2P_CHAT_MESSAGE` (opcode `0x68`), `CONTRACT_PUBLISH`, `CONTRACT_MESSAGE`, and `CONTRACT_PROPOSAL` are decoded by `Message.fromBuffer` without any special handling in this package. The HTTP server passes them through to the Hub / Peer pipeline. Mesh flood uses bit-identical `P2P_RELAY` outer frames (no hop re-sign); Peer emits `chat` / `contract:publish` / `contract:message` / `contract:proposal` as configured.

**Directed onion (`P2P_FORWARD`, opcode `0x45`):** decoded by `@fabric/core` and **terminated by Peer** (peel / single-peer forward). `FabricHTTPServer` does not implement onion routing. Browsers should call Hub JSON-RPC **`SendOnion`** (or run a desktop Peer); do not expect WebSocket fan-out of outer onion frames. See `@fabric/core` [`docs/P2P_FORWARD.md`](https://github.com/FabricLabs/fabric/blob/master/docs/P2P_FORWARD.md).

**Application namespaces** (see `@fabric/core` [docs/APPLICATION_NAMESPACES.md](https://github.com/FabricLabs/fabric/blob/master/docs/APPLICATION_NAMESPACES.md) and `MESSAGES.md` §3): `P2P_CHAT_MESSAGE` is the global shoutbox; `CONTRACT_PUBLISH` / `CONTRACT_MESSAGE` (`P2P_CONTRACT_*`) gossip application/Federation namespaces — apps ignore irrelevant `contract` ids; Federation validators define each namespace’s convergent timeline. Catalog: `@fabric/core/functions/applicationNamespaces`.

## `JSONCall` request body (WebSocket)

```json
{
  "method": "MethodName",
  "params": [ … ]
}
```

### `JSONCallResult` response envelope

The server replies with another outer `JSONCall` whose UTF-8 body uses method
**`JSONCallResult`** (see `functions/fabricJsonRpcTransport.js`).

**Correlation:** `params[0]` is a hash derived from the request body
(`sha256(sha256(utf8-body).hex).hex` via `computeWebSocketJsonCallHashPair`) so
clients can match replies to calls without relying on JSON-RPC `id` alone.
Transport-auth denials (`-32001`) and handler exceptions use the **same** body-derived
hash (computed before `JSON.parse`) so clients can correlate failures to the call they sent.

**Success body:**

```json
{
  "method": "JSONCallResult",
  "params": [ "<requestHashHex>", <result> ]
}
```

**Error body** (e.g. auth denial in `tests/security.auth.server.js`):

```json
{
  "method": "JSONCallResult",
  "params": [ "<requestHashHex>", null ],
  "error": { "code": -32001, "message": "…" }
}
```

HTTP JSON-RPC (`POST` paths from `jsonRpc.paths`) uses standard JSON-RPC 2.0
success/error envelopes (`buildJsonRpcSuccessEnvelope` /
`buildJsonRpcErrorEnvelope`) with the same method handlers.

Covered by `tests/standards.http.js`, `tests/web.server.ws.jsoncall.js`, and
`tests/security.auth.server.js`.

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
