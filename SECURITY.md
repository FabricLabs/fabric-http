# Security (`@fabric/http`)
HTTP / WebSocket gateway for Fabric peers and browser clients.

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
- **WebSocket `GenericMessage` AMP-verify** — unauthenticated frames are already dropped before local `call` dispatch and `handleFabricMessage` peer broadcast (`types/server.js`). Remaining: prefer named outer types / `JSONCall` for new Hub UI paths; require `websocket.requireClientToken` on shared hosts; optionally verify AMP signatures before any remaining peer relay of signed carriers; do not treat unsigned JSON carriers as equivalent to author-signed AMP. Hub tracking: [MESSAGE_TRANSPORT.md](https://github.com/FabricLabs/hub.fabric.pub/blob/master/MESSAGE_TRANSPORT.md).
- **Device-link / site-login** — keep Hub origin allowlists fail-closed; never treat `X-Forwarded-*` as proof of loopback.
- ~~**SLIP-0044 regen**~~ — `scripts/slip-0044.js` fetches a pinned commit (`a8f4330…`) and validates row count / field shapes before rewriting `settings/slip-44.json`.
- ~~**Docs polish (PR #69)**~~ — `docs/MESSAGE_SPEC.md` documents `JSONCallResult` success/error + hash correlation; MD040 language tags land on flow fences in `MESSAGE_PROTOCOL_REPORT.md` / `AUDIT.md`.
- **`@fabric/core` pin hygiene** — `package.json` / lockfile pin immutable commit `0e1fa1921c00b4d5571c511f8bd7730323653a73` (see [AUDIT.md](AUDIT.md)); refresh via `feature/rsi` then re-pin the resolved SHA with Hub / apps.
- **402 document offer digests** — `contentHashHex` / `blobHashHex` accept exact 64-hex only (no truncation); `blobIndex`-only offers still emit `documentOffer`; invalid fields are omitted.
- **RFC6902 sidechain JSON bridge** — full multi-op patch fidelity in `messageBodyJsonBridge` remains outstanding (see [AUDIT.md](AUDIT.md)); do not rely on JSON→fields for arbitrary patch lists.
- **Fabric coin types (downstream)** — core pin includes **7777** / **7778**; Hub/app helpers that still hardcode `7778` for mainnet still need alignment.
- **Site-login delegation token** — fail-closed when `expected` supplies only one of `sessionId` / `origin`; remaining: separate opaque bearer (not path `sessionId`) + `timingSafeEqual` on shared hosts.

## Process
1. `npm test` before merging HTTP/auth changes.
2. Never commit seeds, admin tokens, or production `stores/`.
3. Prefer loopback HTTP unless shared mode is intentional.

## Disclosure
Report security issues privately to the maintainers (GitHub Security Advisories /
private maintainer contact in README) rather than opening a public issue with
exploit details. Expect an initial response within a few business days.
