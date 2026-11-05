# Passport peer sessions over WebSockets and HTTP
How a user signs in to a Fabric peer (a Hub, a relay, an app server) *by the
peer's key*, from any page, and how later requests prove who sent them. The
frames and their checks are core's (`@fabric/core` `docs/PASSPORT.md`, "Peer
sessions (v3)"). Everything here — sockets, routes, headers, request bodies,
the page protocol — is `@fabric/http`.

No web origin is pinned. Passport (or a native client) opens the connection
itself, checks the peer's signed challenge, and keeps the session and its
session key. A page never holds a token, a cookie, or the key.

## Code
| Module | Side | What it does |
|---|---|---|
| `functions/passportPeer` | peer | `createPassportPeer({ key, network, purpose, homes, onSession })`: handshake on any connection (`handleFrame`), over HTTP (`handleHttpFrame`), `callerOf` for signed frames on a socket, `authorizeRequest` for signed HTTP requests. `createPassportPeerHttp(peer)`: routes and middleware. |
| `functions/passportPeerClient` | signer | `openPeerSession({ transport, peer, sign })` with `webSocketTransport(ws)` or `httpTransport(base)`; the session handle has `call` (WebSocket), `authorize` / `fetch` (HTTP), `sign`, `close`. `signWithKey(identityKey)` for native clients and tests. |
| `functions/passportPeerRequest` | both | The `X-Fabric-Request` frame: `createPeerRequest`, `readPeerRequest`, `requestBodyHash`. |
| `functions/passportPage` | page | `probePassportPeer`, `connectPeer`, `callPeer`, `authorizePeerRequest`, `fetchAsPeer`, `closePeer`. |
| `types/server` | peer | `HTTPServer#attachPassportPeer(peer)` (or `settings.passportPeer`). |

## On an `HTTPServer`
`attachPassportPeer(peer)` does three things:

1. **WebSockets.** Core Passport frames (`PASSPORT_CONNECT`, `PASSPORT_ASSERTION`,
   `PASSPORT_RESUME`) are answered on the socket, before any transport gate.
   After that, a frame on that socket whose verified author is the session key
   speaks for the user. A JSON-RPC method registered
   `_registerMethod(name, fn, { withContext: true })` is called as
   `fn({ passport, transportAuthorized }, ...params)`, where `passport` is the
   session view or null.
2. **Routes.** `GET /sessions/peer` answers `{ peer, network }`.
   `POST /sessions/peer { frame }` runs one handshake frame over HTTP and
   answers `{ frame, binding? }`.
3. **Requests.** Any request carrying `X-Fabric-Request` gets
   `req.passportSession`, or a 401 when the header doesn't hold. The body
   parsers keep `req.rawBody` for such requests, so the signature is checked
   against the bytes as sent.

Hosts that aren't `HTTPServer`s (a bare `http` server) use
`createPassportPeerHttp(peer).routes` and `readRequestSession(req)` directly.

## The HTTP handshake
1. `POST /sessions/peer { frame: <PASSPORT_CONNECT> }` → `{ frame: <PASSPORT_CHALLENGE>, binding }`.
2. `POST /sessions/peer { frame: <PASSPORT_ASSERTION> }` with `X-Fabric-Binding: <binding>`
   → `{ frame: <PASSPORT_SESSION> }`.

Refusals come back as a `PASSPORT_REFUSED` frame (HTTP 400). A binding serves
one handshake, for at most four minutes. It is not a credential: it only says
which challenge an assertion answers, and the session it yields is useless
without the session key.

## `X-Fabric-Request`
A core `CONTRACT_MESSAGE` under the contract id
`sha256("@fabric/http:PassportRequest:1")`, signed by the session key:

| Field | Value |
|---|---|
| `recipient` | the peer's compressed pubkey |
| `ref` | the session id |
| `payload` | JSON `{ type: 'PassportRequest', v: 1, method, target, bodyHash, nonce, issuedAt, expiresAt }` |

`target` is the path and query as sent; `bodyHash` is sha256 of the body bytes
(of nothing for an empty body). The peer refuses a frame:
- for another peer, method, target, or body;
- older than its `expiresAt` (default 60 seconds, at most 3 minutes; 30 seconds of clock skew);
- not signed by the live session's key;
- whose nonce it has already seen.

## Pages
A page asks Passport over the `passportPage` protocol (each message with a
transferred `MessagePort`; answers come on that port only):

| Page sends | Passport answers |
|---|---|
| `PASSPORT_HELLO` | `{ v: 2, peer: 3 }` when it has peer sessions (`probePassportPeer`) |
| `PASSPORT_PEER_CONNECT { endpoints, peer?, request?, purpose? }` | `PASSPORT_PEER_SESSION { session }` |
| `PASSPORT_PEER_CALL { sessionId, method, params }` (WebSocket peers) | `PASSPORT_PEER_RESULT { result }` |
| `PASSPORT_PEER_AUTHORIZE { sessionId, url, method, body }` (HTTP peers) | `PASSPORT_PEER_AUTHORIZATION { header }` |
| `PASSPORT_PEER_CLOSE { sessionId }` | `PASSPORT_PEER_CLOSED` |

`endpoints` are `ws:` / `wss:` URLs (WebSocket peers) or `http:` / `https:`
origins (HTTP peers). Passport keys sessions by (page origin, peer), answers
only the origin that opened a session, and signs an `X-Fabric-Request` only for
a URL on the peer's own origin.

Passport's prompt shows the peer's key, the user's name for it, and the page
origin. It warns on a new peer, and on a new page for a known peer, unless the
page is one of the peer's signed `homes`.

## Native clients
A native client (GoonCitizen desktop, a script) is its own signer. It holds the
identity key, so it uses `openPeerSession({ transport: httpTransport(origin),
sign: signWithKey(identityKey, { signer }) })` and `session.fetch(url, init)`
for each request. It should remember the peer's key per origin and pass it as
`peer` next time, so a changed key is refused.

## What this protects against
- **A lifted header** works once, for one method, path, and body, for about a
  minute.
- **A relay or a phishing page in the middle** can forward the handshake, but
  it can't sign as the session key.
- **A page using another page's session**: Passport answers only the origin
  that opened it, and opening one needs the user's approval in a prompt that
  names the peer.
- **CSRF**: the session is not ambient (no cookie), so a cross-site form can't
  act as the user.
- **Not covered**: transport confidentiality (use `https:` / `wss:`).
