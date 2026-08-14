# Outstanding (security-first)
Living queue for this repo. Detail and closed items live in [SECURITY.md](../SECURITY.md) and [AUDIT.md](../AUDIT.md). Suite march: [@fabric/core `docs/PRODUCTION_MARCH.md`](https://github.com/FabricLabs/fabric/blob/feature/rsi/docs/PRODUCTION_MARCH.md).

**Last reviewed:** 2026-08-14 (http `f88da9c` + this slice, core lockfile `a80e8aa7e`).

## Blockers before treating public Hub login as browser-grade auth
1. **Possession proof on redeem** — `GET /sessions/:id`, LiveRelay Bearer, and device-link GET still authorize with forgeable `Origin` / `Referer` / `Sec-Fetch-Site` (plus thin-client Origins on allowlisted hubs). QR / `fabric://` expose `sessionId`. Needs a one-time poll secret or signed browser challenge ([PR #69](https://github.com/FabricLabs/fabric-http/pull/69) High, still open).
2. **Bind `sessionId` into device-link attest messages** — coordinated Passport / desktop / GoonCitizen bump so a captured signature cannot recreate `linked` under a new id.

## Next slices
- [ ] Re-export `identityCrossSign` / `identityCrossSignVerify` / `fabricIdentitySchnorr` from core once those leaves are on the `@fabric/core` pin (local http WIP exists; do not enable — core `a80e8aa7e` does not ship them). Keep `package.json` exports pointing at local copies until then, or CI `MODULE_NOT_FOUND`.
- [ ] Prefer named AMP / `JSONCall` on public WebSocket paths; `websocket.requireClientToken` on shared hosts.
- [ ] `dns.lookupSync` → `dns.promises.lookup` (Node 24 deprecation).
- [ ] RFC6902 `messageBodyJsonBridge` full multi-op fidelity (do not rely on JSON→fields for arbitrary patches).
- [ ] Per-origin device-link create quota (FIFO eviction under unauthenticated flood).

## Closed this pass (do not re-open)
- Hub self-sign opt-in + **loopback-only**; `wss:` origin map via `parseFabricHubAddress`; JSONCall unauthorized hash + watch-only `signWithKey`; HTTPS-only default hub allowlist; thin-client device-link Origins (`capacitor:` / loopback WebView / `chrome-extension:` / `moz-extension:`) on allowlisted hubs; 402 header omits `costBasisSats`.
- Bracketed Fabric peer IPv6 uses `net.isIP` (`[::::]:7777` rejected). Do not derive 402 `purchasePriceSats` from `costBasisSats` in the header builder (that field stays omitted on the wire).
- `scripts/cli.js` reads `--wallet` / `--wallet=` from argv **before** `Environment.start()` (`functions/cliWalletArgv.js`).

## PRs
[#69](https://github.com/FabricLabs/fabric-http/pull/69) — Cursor review on `f88da9c` restates **2 High + 2 Medium** on Origin-gated redeem / device-link `sessionId` bind (still open; not this slice). CodeRabbit 402 markup-from-`costBasisSats` is **wontfix** (privacy). Pin `@fabric/core` via lockfile (`#feature/rsi` + `npm run report:install`), not a SHA in `package.json`.
