# Outstanding (security-first)
Living queue for this repo. Detail and closed items live in [SECURITY.md](../SECURITY.md) and [AUDIT.md](../AUDIT.md). Suite march: [@fabric/core `docs/PRODUCTION_MARCH.md`](https://github.com/FabricLabs/fabric/blob/feature/rsi/docs/PRODUCTION_MARCH.md).

**Last reviewed:** 2026-08-14 (http this slice, core lockfile `5557a2bf`).

## Blockers before treating public Hub login as browser-grade auth
1. **Possession proof on redeem** — `GET /sessions/:id`, LiveRelay Bearer, and device-link GET still authorize with forgeable `Origin` / `Referer` / `Sec-Fetch-Site` (plus thin-client Origins on allowlisted hubs). QR / `fabric://` expose `sessionId`. Needs a one-time poll secret or signed browser challenge ([PR #69](https://github.com/FabricLabs/fabric-http/pull/69) High, still open).
2. **Bind `sessionId` into device-link attest messages** — coordinated Passport / desktop / GoonCitizen bump so a captured signature cannot recreate `linked` under a new id.

## Next slices
- [ ] Prefer named AMP / `JSONCall` on public WebSocket paths; `websocket.requireClientToken` on shared hosts.
- [ ] RFC6902 `messageBodyJsonBridge` full multi-op fidelity (do not rely on JSON→fields for arbitrary patches).
- [ ] Always-fresh device-link nonce (reject client-supplied) — coordinated with Passport / GoonCitizen / Hub (clients currently sign a client-chosen nonce into the offer).
- [ ] Optional: bump `puppeteer` to **25.7.0** to drop the `extract-zip@2.0.1` advisory (Sandbox / browser tests).

## Closed this pass (do not re-open)
- HTTPServer no longer logs full Internal message/commit JSON at default verbosity; commit Transactions omit full `state`; StateUpdate dumps are verbosity-gated (Hub OOM from OpenSSF advisory floods).
- Mesh shoutbox helper `functions/fabricChatNormalize` re-exports `@fabric/core/functions/fabricChatText` (`chatTextOf` / `chatActorIdOf`); Hub cache shape stays here (`normalizeP2pChatMessage`).
- `canonicalizeFabricPeerDial` rewrites `hub.fabric.pub` / `relay.goon.vc` `:7778` → `:7777` (and dedicated NIC IPs `65.21.231.166` / `65.21.231.149`) and drops self-dials (playnet RSI error-log storm). `pubkey@host:port` splits to the same host as `host:port`. A unicast `FABRIC_INTERFACE` does not treat sibling NICs as self.
- Hub self-sign opt-in + **loopback-only**; `wss:` origin map via `parseFabricHubAddress`; JSONCall unauthorized hash + watch-only `signWithKey`; HTTPS-only default hub allowlist; thin-client device-link Origins (`capacitor:` / loopback WebView / `chrome-extension:` / `moz-extension:`) on allowlisted hubs; 402 header omits `costBasisSats`.
- Bracketed Fabric peer IPv6 uses `net.isIP` (`[::::]:7777` rejected). Do not derive 402 `purchasePriceSats` from `costBasisSats` in the header builder (that field stays omitted on the wire).
- `scripts/cli.js` reads `--wallet` / `--wallet=` from argv **before** `Environment.start()` (`functions/cliWalletArgv.js`). Separate `--wallet -p` is not a path.
- Own-host DNS cache via `dns.promises.lookup` (no `lookupSync`). Device-link per-origin create FIFO cap (`MAX_SESSIONS_PER_ORIGIN`).
- Expired `GET /sessions/:delegationToken` requires matching Bearer (path is not a registry credential). Browser device-link fetch omits client-set Origin/Referer.
- CLI `scripts/cli.js` / `scripts/node.js` load `~/.fabric/env` via `@fabric/core/functions/fabricHomeEnv` before `Environment.start()` (process env still wins).

## PRs
[#69](https://github.com/FabricLabs/fabric-http/pull/69) — Cursor review restates **2 High + 2 Medium** on Origin-gated redeem / device-link `sessionId` bind (still open; not this slice). CodeRabbit 402 markup-from-`costBasisSats` is **wontfix** (privacy). Federation invite policy/`accept`, ARC type-only, 402 blob ids, `wss:` origin, JSONCall hash, and `--wallet` are **already in tree**. Pin `@fabric/core` via lockfile (`#feature/rsi` + `npm run report:install`), currently **`5557a2bf`** ([core #185](https://github.com/FabricLabs/fabric/pull/185) home-env + shoutbox + IPv6 dial + wallet `fromFile`). `puppeteer@25.7.0` (extract-zip) is deferred.
