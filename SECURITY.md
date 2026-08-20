# Security (`@fabric/http`)
HTTP / WebSocket gateway for Fabric peers and browser clients.

**Outstanding queue:** [docs/OUTSTANDING.md](docs/OUTSTANDING.md).

## Adversarial environment
Fabric networks are intended for deployment where **peers, relays, hubs, and operators may be hostile**. Design and review against:

- Untrusted TCP / WebSocket / WebRTC neighbors (forgery, replay, amplification, pin hijack)
- Phishing of identity flows (`fabric://login`, device-link) toward attacker-controlled hubs
- Public observability of unsigned or plaintext application traffic unless an explicit seal is used
- No reliance on an “honest majority” of random internet peers for key custody

This package fails closed on missing auth secrets, enforces Hub origin allowlists for site-login / device-link completion, and treats shared HTTP bind as an explicit operator choice.

**Basics coverage:** [`tests/adversarialEnvironment.basics.test.js`](tests/adversarialEnvironment.basics.test.js). Broader auth / WS hardening: [`tests/security.auth.server.js`](tests/security.auth.server.js).

## Hub allowlist
`functions/fabricHubAllowlist.js` — default network hubs + loopback; extras via `FABRIC_HUB_ALLOWLIST`. Unknown origins must not receive signed login/link completions.

## Outstanding (auth / carriers)
- **WebSocket `GenericMessage` AMP-verify** — unauthenticated frames are already dropped before local `call` dispatch and `handleFabricMessage` peer broadcast (`types/server.js`). Remaining: prefer named outer types / `JSONCall` for new Hub UI paths; optionally verify AMP signatures before any remaining peer relay of signed carriers; do not treat unsigned JSON carriers as equivalent to author-signed AMP. Hub tracking: [MESSAGE_TRANSPORT.md](https://github.com/FabricLabs/hub.fabric.pub/blob/master/MESSAGE_TRANSPORT.md). Shared-host WS: Hub calls `applySharedModeWebsocketGate` (`functions/httpSharedMode.js`) so shared HTTP bind (`HTTP_SHARED_MODE` / `0.0.0.0`) auto-enables `websocket.requireClientToken` (fail-closed even when `FABRIC_WS_CLIENT_TOKEN` is unset — handshakes reject until a token is configured). Explicit `websocket.requireClientToken: false` still wins.
- **Site-login / device-link poll secret (PR #69 High)** — Hub self-sign is **opt-in** (`allowHubSelfSign === true`; Hub desktop enables it) and **loopback-only**. Site-login and LiveRelay share `clientMayPollDesktopSession` for **pending** polls. Off-loopback **signed** `GET /sessions/:id` (Hub + LiveRelay Bearer redeem) and **DELETE** `/device-links/:id` require the create-response `pollSecret` via `X-Fabric-Poll-Secret` (never on `fabric://` / QR / query strings). Device-link GET pending/accepted/linked stays Origin-gated so the responder can complete with only `sessionId`. Keep Hub origin allowlists fail-closed; never treat `X-Forwarded-*` as proof of loopback.
- ~~**Cleartext production hub defaults**~~ — default allowlist is **HTTPS-only** for network hubs; cleartext `http://hub.fabric.pub` / `relay.goon.vc` / `goon.vc` require `FABRIC_HUB_ALLOWLIST` / `opts.extra`. Loopback `http://` remains allowed.
- **Device-link attestation binding** — offer replay of `(nonce, initiatorId, origin)` after link (and while pending) is rejected; create path and `offerReplayKey` canonicalize origin via `normalizeHubOrigin`. Remaining: bind random `sessionId` into `buildDeviceLinkMessage` (and coordinated Passport / desktop / SCL signers) so captured link signatures cannot recreate a `linked` session under a new id.
- ~~**SLIP-0044 regen**~~ — `scripts/slip-0044.js` fetches a pinned commit (`a8f4330…`) and validates row count / field shapes before rewriting `settings/slip-44.json`.
- ~~**Docs polish (PR #69)**~~ — `docs/MESSAGE_SPEC.md` documents `JSONCallResult` success/error + hash correlation; MD040 language tags land on flow fences in `MESSAGE_PROTOCOL_REPORT.md` / `AUDIT.md`.
- ~~**`@fabric/core` pin hygiene**~~ — lockfile tip `2a074a71d23839e74519f529fb0f520a862c7dda` (refreshed via `FabricLabs/fabric#feature/rsi`). Coordinate Hub / apps on the same SHA for releases; `report:install` removes `package-lock.json` then `npm i --allow-git=all` (nested git SHA prepare). Bump the tip with `npm install FabricLabs/fabric#feature/rsi --allow-git=all` when core moves.
- ~~**402 document offer digests**~~ — `contentHashHex` / `blobHashHex` accept exact 64-hex only (no trim/truncation); `blobIndex` accepts non-negative safe integers only (no string `Number()` coercion); `blobIndex`-only offers still emit `documentOffer`; invalid fields are omitted.
- ~~**Peer host self-check DNS**~~ — IPv6 bracketed addresses parse correctly; ports must be decimal **1..65535** (`parseFabricPeerPort`); DNS cache keys include `ownHosts`. Own-host checks use `dns.promises.lookup` (cached; cache miss is **not** treated as self). Optional `pubkey@host:port` userinfo is stripped so gossip pins share the same host as `host:port`.
- **RFC6902 sidechain JSON bridge** — full multi-op patch fidelity in `messageBodyJsonBridge` remains outstanding (see [AUDIT.md](AUDIT.md)); do not rely on JSON→fields for arbitrary patch lists.
- **Fabric coin types (downstream)** — core pin includes **7777** / **7778**; Hub/app helpers that still hardcode `7778` for mainnet still need alignment.
- **Site-login delegation token** — fail-closed when `expected` supplies only one of `sessionId` / `origin`; expired-session GET requires opaque Bearer registry key + `timingSafeEqual` bind to path `sessionId`, or `Authorization: Bearer` matching path when the path **is** the token; unauthenticated `GET /sessions/:delegationToken` is 404. LiveRelay omits Bearer when `issueBearer` is absent (no orphan random token). Remaining: Hub dual-key legacy cleanup if any path still stores under `sessionId`.
- **Device-link client** — `createDeviceLinkOffer` / fetch / signature helpers require an explicit browser `origin` (no `hubBase` fallback).

## Process
1. `npm test` before merging HTTP/auth changes.
2. Never commit seeds, admin tokens, or production `stores/`.
3. Prefer loopback HTTP unless shared mode is intentional.

## Disclosure
Canonical monitored contact: **`security@fabric.pub`** (also in [README.md](README.md) / [AUDIT.md](AUDIT.md)).
GitHub Security Advisories are an alternate private channel. Do not open a public
issue with exploit details. Expect an initial response within a few business days.
