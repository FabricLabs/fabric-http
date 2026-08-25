# Outstanding (security-first)
Living queue for this repo. Detail and closed items live in [SECURITY.md](../SECURITY.md) and [AUDIT.md](../AUDIT.md). Suite march: [@fabric/core `docs/PRODUCTION_MARCH.md`](https://github.com/FabricLabs/fabric/blob/feature/rsi/docs/PRODUCTION_MARCH.md).

**Last reviewed:** 2026-08-24 — suite audit pass. `npm test` **253 passing / 0 failing**
(21 pending).

**Chat timestamps: fixed in this module.** `normalizeP2pChatMessage` gated its
fallbacks on `Number.isFinite(created)`, but `Number(null)` and `Number('')` are a
*finite* **0** — so a `created: null` message was stamped **epoch 0**, and the
`object.ts` fallback was skipped entirely, meaning a message carrying a valid ISO
timestamp still landed in 1970. Negative values passed through untouched. All three
fallbacks now require a **positive** value. HTTP Hub compatibility wrappers can
collapse to this module when the pin exports the fix. Tests:
`tests/fabricPeeringChat.test.js` (non-positive → `now()`, `ts` fallback, positive
preserved).

Invite expiry (`DEFAULT_FEDERATION_INVITE_TTL_MS`, `normalizeInviteExpiresAtMs`,
`resolveFederationInviteExpiresAt`, `federationInviteIsExpired`, and
`buildFederationContractInviteJson` stamping `expiresAt`) is **staged here** as the
suite source of truth. Consumer shims that wrapped the builder should collapse to
this module when the pin exports `resolveFederationInviteExpiresAt`. **Bump
downstream lockfiles when this lands** so those shims delete themselves.

**Prior review:** 2026-08-20. [#69](https://github.com/FabricLabs/fabric-http/pull/69) signed-session redeem and device-link **DELETE** now require the create-response `pollSecret` off-loopback. Remaining: bind `sessionId` into device-link attest messages (coordinated client bump); device-link GET `linked` still Origin-gated so the responder (QR only) can read attestations. Already in tree: Hub self-sign loopback, `wss:` origin map, HTTPS allowlist, `offerReplayKey` canonicalize, `security@fabric.pub`, SLIP-0044 row-count, peer port `1..65535`, WS close wait, commit Transaction assertion, POST-null 400, device-link cancel `ok: false`. File-count: restored generated `libraries/fomantic/dist` and `docs/*.html` from FabricLabs/master (`4779a319`) so GitHub/CodeRabbit stop counting vendor/JSDoc deletes. Do not add playnet/nmap/wasm/backups trees.

## Blockers before treating public Hub login as browser-grade auth
1. **Coordinated clients** — Hub SPA, site-login hosts, and browser wallet initiators must send `X-Fabric-Poll-Secret` from the create JSON. Do not put `pollSecret` on `fabric://` / QR / query strings.
2. **Bind `sessionId` into device-link attest messages** — coordinated client bump so a captured signature cannot recreate `linked` under a new id.

## Next slices
- [ ] Hub heap OOM is **not** the http Internal-log cut (production host scan **2026-08-16T22:06Z**: **306** PM2 restarts, ~3.6 min mean, ~2.9 GiB). Live http pin is still `1b162e35`; local/PR HEAD is `fbf9e63`. Remaining retainers are Hub `Filesystem.publish` + unbounded `STATE` (core + Hub deploy). Hub↔RSI hairpin still missing. Do not raise `--max-old-space-size`.
- [ ] Prefer named AMP / `JSONCall` on public WebSocket paths; `websocket.requireClientToken` on shared hosts.
- [ ] Originate AMP `parent` on Hub/http signed frames (application relays already chain durable frames). Inbound zeros stay accepted.
- [ ] RFC6902 `messageBodyJsonBridge` full multi-op fidelity (do not rely on JSON→fields for arbitrary patches).
- [ ] Always-fresh device-link nonce (reject client-supplied) — coordinated client bump (clients currently sign a client-chosen nonce into the offer).
- [ ] Optional: bump `puppeteer` to **25.7.0** to drop the `extract-zip@2.0.1` advisory (Sandbox / browser tests).

## Closed this pass (do not re-open)
- HTTPServer no longer logs full Internal message/commit JSON at default verbosity; commit Transactions omit full `state`; StateUpdate dumps are verbosity-gated (Hub OOM from OpenSSF advisory floods).
- **HTTPServer.start** awaits the Node `listening` event (or rejects on bind error) so `server.http.listening` is true before `start()` resolves. Tests: `tests/web.server.js`.
- Mesh shoutbox helper `functions/fabricChatNormalize` re-exports `@fabric/core/functions/fabricChatText` (`chatTextOf` / `chatActorIdOf`); Hub cache shape stays here (`normalizeP2pChatMessage`).
- `canonicalizeFabricPeerDial` rewrites known public hub seeds on historical `:7778` → `:7777` (and dedicated NIC IPs) and drops self-dials. `pubkey@host:port` splits to the same host as `host:port`. A unicast `FABRIC_INTERFACE` does not treat sibling NICs as self.
- Hub self-sign opt-in + **loopback-only**; `wss:` origin map via `parseFabricHubAddress`; JSONCall unauthorized hash + watch-only `signWithKey`; HTTPS-only default hub allowlist; thin-client device-link Origins (`capacitor:` / loopback WebView / `chrome-extension:` / `moz-extension:`) on allowlisted hubs; 402 header omits `costBasisSats`. Signed login redeem + device-link DELETE require `pollSecret` off-loopback (`tests/pr69.review.coverage.js`). Pending GET stays Origin-gated (signer/responder).
- Bracketed Fabric peer IPv6 uses `net.isIP` (`[::::]:7777` rejected). Do not derive 402 `purchasePriceSats` from `costBasisSats` in the header builder (that field stays omitted on the wire). Invalid 402 blob ids (`blobIndex` strings, non-64-hex hashes) and `contentBase64` are omitted rather than rounded/truncated.
- Shared-bind helper `applySharedModeWebsocketGate` fail-closes `websocket.requireClientToken` (explicit `false` still wins). Hub `scripts/hub.js` applies it; do not wire it inside the `HTTPServer` constructor (default host is already `0.0.0.0`).
- `scripts/cli.js` reads `--wallet` / `--wallet=` from argv **before** `Environment.start()` (`functions/cliWalletArgv.js`). Separate `--wallet -p` is not a path.
- Own-host DNS cache via `dns.promises.lookup` (no `lookupSync`). Device-link per-origin create FIFO cap (`MAX_SESSIONS_PER_ORIGIN`).
- Expired `GET /sessions/:delegationToken` requires matching Bearer (path is not a registry credential). Browser device-link fetch omits client-set Origin/Referer.
- CLI `scripts/cli.js` / `scripts/node.js` load `~/.fabric/env` via `@fabric/core/functions/fabricHomeEnv` before `Environment.start()` (process env still wins). Missing-module catch is `MODULE_NOT_FOUND` only so a broken home env still fails startup.
- `@fabric/core` lockfile **`2a074a71`**: dependency-error resolve + file-count fold + Filesystem publish retain cut + production follow-ups from [core #185](https://github.com/FabricLabs/fabric/pull/185); MuSig2 `autoAccept` default off, BIP-21 `req-*`, collection cwd-containment, Codacy `Number('…')` uint32/purpose literals; plus `fabricIdentityAccountPath` / AMP wire name over inventory JSON `type: 98` (locked in `tests/pr69.review.coverage.js`). Next core pin is [#186](https://github.com/FabricLabs/fabric/pull/186) (handshake-bus + gossip catalog; HEAD **`9c6ade0`**).
- Device-link **DELETE** `/device-links/:sessionId` cancels pending/accepted sessions (404-as-success; `linked` is 409). Client `cancelDeviceLinkSession` returns `ok: false` when fetch rejects. Off-loopback DELETE requires `pollSecret`. Locked in `tests/fabricDeviceLinkHttp.unit.js`.

## PRs
[#69](https://github.com/FabricLabs/fabric-http/pull/69) — Cursor Highs on Origin-gated **signed** redeem / device-link cancel are addressed with `pollSecret` (not extra Origin checks). Device-link GET pending/accepted/linked stays Origin-gated for the QR responder. Remaining coordinated work: client header send + bind `sessionId` into attest messages. CodeRabbit 402 markup-from-`costBasisSats` is **wontfix** (privacy). Codacy reports **0** new issues (`tests/**` excluded). Pin `@fabric/core` via lockfile (`#feature/rsi`), currently **`2a074a71`** ([core #185](https://github.com/FabricLabs/fabric/pull/185); next [#186](https://github.com/FabricLabs/fabric/pull/186) HEAD **`9c6ade0`**). `puppeteer@25.7.0` (extract-zip) is deferred. Docstring 80% gate is deferred. GitHub/CodeRabbit file-count vs FabricLabs/master is the vendor `dist` + JSDoc HTML deletes — restore those trees rather than deleting them on this PR. RFC6902 multi-op `messageBodyJsonBridge` remains deferred.
