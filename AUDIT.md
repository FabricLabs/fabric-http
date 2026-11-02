# Fabric HTTP Security Audit
Living posture notes for `@fabric/http` **0.1.0-RC1**. Re-run **`npm audit`** after dependency changes; keep this file aligned with the current lockfile.

## Status (2026-11-01)

| Area | Posture |
|------|---------|
| `@fabric/core` | Git pin `FabricLabs/fabric#600ed7050ae4ecde64e5fecc447ff1231cef91d6` (Node **26.12.1**) |
| npm `allow-git` | **`.npmrc` `allow-git=all`** — nested git-dep preparation resolves core to a commit SHA; `root` is refused (intentional — do not flip to `root`) |
| WebSocket (`ws`) | **Mitigated** — direct **`8.22.1`** (GHSA-58qx-3vcg-4xpx / fragment DoS); no override. jayson keeps its own `ws@7.5.13` (`^7.5.10`, patched) |
| Test tooling | **`mocha@12.0.3`** / **`c8@12.0.0`** (same as core / Hub) — mocha 12 resolves `serialize-javascript@^7.1.1` and `diff@^9`, so those overrides are gone |
| Express / body-parser / qs | **Mitigated** — `express@5.3.0` and direct `body-parser@2.4.0` both resolve `qs@6.17.1`; no override. Routes use path-to-regexp 8+ syntax (`/{*splat}`, not `/*`) |
| Fomantic UI | **`fomantic-ui@2.10.0-beta.128`** (build-only devDependency) — its GitHub admin tooling (`@octokit/*`, `@actions/*`) is now Fomantic's own devDependency, so the `undici` / `@octokit` overrides are gone; it depends on the scoped `@fomantic/*` gulp plugins directly, so the npm aliases are gone too. Its flag and emoji CSS no longer loads Twemoji from jsDelivr: the SVGs are imported at build time from a SHA-256-pinned jdecked/twemoji `v17.0.3` release (`functions/twemoji.js`, not committed), and `build:semantic` fails on any remote `url()`. **Known, accepted:** the six dev-only findings below come from its gulp plugins and have no upstream fix |
| Markdown (SLIP-0044 script) | **Mitigated** — replaced `showdown` (unfixed ReDoS GHSA-rmmh-p597-ppvv) with **`marked@18.1.2`** |
| PeerJS / browser mesh | **Removed** — `types/swarm.js` is a no-op stub; Hub native WebRTC |
| Browser `crypto` polyfill | **Removed** `crypto-browserify` (and with it `elliptic`, `asn1.js`, `browserify-sign`, `create-ecdh`) — the Compiler maps `crypto` to `functions/browserCrypto.js` (`@noble/hashes` + `@noble/ciphers@2.4.0`), so the `elliptic` override is gone |
| npm audit status | **Production 0** — `npm audit --omit=dev` is a CI gate (`.github/workflows/ci.yml`). **Full tree: 6** (2 low, 4 moderate), all dev-only under `fomantic-ui` (2026-11-01, `express@5.3.0`, `webpack@5.112.2`, `babel-loader@10.1.1`, `@babel/core@8.0.10`, `typescript@7.0.2`, `eslint@10.14.0`, `puppeteer@25.16.0`) |

## Known dev-only findings (accepted)

Both reach only `npm run build:semantic` (the Fomantic theme build), never the published package or a running server.

| Advisory | Path | Why it stays |
|----------|------|--------------|
| `minimatch` &lt; 11.0.1, globparts DoS ([GHSA-g3hv-75wg-m249](https://github.com/advisories/GHSA-g3hv-75wg-m249)) — 4 moderate | `fomantic-ui` → `gulp-if@3.0.0` → `gulp-match@1.1.0` → `minimatch@3.1.5` | `gulp-match` (last release 2022) calls `minimatch(path, pattern)`; only 11.x is patched and it no longer exports a callable function, so no override fits. The globs are Fomantic's own build patterns, not input |
| `deepmerge` prototype poisoning ([GHSA-gcqx-w48m-w2h4](https://github.com/advisories/GHSA-gcqx-w48m-w2h4)) — 2 low | `fomantic-ui` → `gulp-json-editor@2.6.0` → `deepmerge@4.3.1` | No patched release exists, and the advisory covers every version through 4.3.1, so a downgrade would only hide it. `gulp-json-editor` runs only in Fomantic's `install` / admin tasks, which `build:semantic` never invokes |

Local shim packages wired in with `file:` overrides do not work under npm 12 (it resolves the path from the dependent's folder and applies the override to the shim's own dependencies), so do not retry that route.

## Overrides

| Override | Reason |
|----------|--------|
| `glob` → `=14.0.3` | GHSA-3g3m-2fjr-6pw4 (AbortSignal bypass, ≤ 14.0.1) under mocha, c8, js-beautify |
| `minimatch@>=9.0.0 <11.0.1` → `=11.0.3` | GHSA-g3hv-75wg-m249 for every 9.x / 10.x consumer (eslint, mocha, ts-morph, editorconfig, …). Scoped by range so `gulp-match` keeps the callable 3.x |
| `js-beautify` → `$js-beautify` | Moves `gulp-json-editor`'s nested 1.15.4 (old `glob` / `editorconfig`) onto the direct 2.0.3 |
| `page` → `path-to-regexp` `=1.9.0` | GHSA-9wv6-86v2-598j (ReDoS) in the 1.2.1 that `page@1.11.6` asks for; 1.x API unchanged |

Do **not** run `npm audit fix --force` casually — it has proposed downgrading `fomantic-ui`. Prefer explicit pins and a clean `npm audit`.

## Historical backlog (superseded)

Older AUDIT snapshots listed d3-color, gulp-util/lodash.template, peerjs/opencollective, nat-upnp/request (via older `@fabric/core`), and webpack &lt; 5.76. Those either no longer appear in the current audit, or were addressed by direct pins / core upgrades / PeerJS removal. Prefer the live **`npm audit`** output over archived lists below when they disagree.

<details>
<summary>Archived npm audit excerpt (pre-2026-08 cleanup)</summary>

```text
# npm audit report (historical)

d3-color  <3.1.0
… (d3 / d3-graphviz tree; package.json now pins d3@7.9.0 / d3-graphviz@5.6.0)

diff / gulp-dedupe / fomantic-ui
… (diff overridden to 8.0.4)

jquery  <=3.4.1
… (direct jquery@3.7.1)

jsdom  <=16.5.3
… (direct jsdom@29.x)

peerjs / opencollective / node-fetch
… (peerjs removed; Swarm stub)

request / nat-upnp via older @fabric/core
… (resolve with current core pin)

webpack  5.0.0 - 5.75.0
… (webpack@5.109.2)

ws  6.x / 8.18.x
… (ws@8.21.2)
```

</details>

## Recommendations

1. After dependency edits: **`npm ci`** then **`npm audit`** and **`npm test`** against the checked-in lockfile. Use **`npm run report:install`** only when intentionally refreshing git pins (`#feature/channels`); it wipes `node_modules` **and** `package-lock.json`, then `npm i --allow-git=all`. Diff the new lockfile before committing — do not treat the wiped lockfile as a release artifact until that review.
2. Keep **`engines.node`** at **26.12.1** with Hub / `@fabric/core`.
3. Do not reintroduce **peerjs** or **showdown**.
4. Treat Fomantic gulp as **build-only**; never expose its admin GitHub tooling on production HTTP paths.
5. Coordinate `@fabric/core` bumps with Hub (`npm run link:fabric` / git pin) so Message/Peer/opcode behavior stays aligned. Install from `FabricLabs/fabric#feature/channels` when refreshing, then **re-pin** `package.json` to the lockfile’s resolved SHA — do not leave a moving branch tip in releases.
6. Before RC: finish GenericMessage AMP-verify / named-type migration with Hub (unauthenticated GenericMessage is already dropped locally; SLIP-0044 fetch is commit-pinned + validated; see [SECURITY.md](SECURITY.md)).
7. Follow-up (Hub / apps): core now ships Fabric BIP44 coin types **7777** (Bitcoin mainnet) / **7778** (otherwise). Align Hub account-derivation helpers that still hardcode `7778` for mainnet paths.
8. Follow-up (larger): `messageBodyJsonBridge` RFC6902 sidechain JSON → typed fields still does not preserve a full multi-op patch sequence end-to-end; keep rejecting unsupported ops and prefer Hub typed carriers until that lands.
9. **Passport v2 sign-in** (`functions/passportRelyingParty`, `functions/passportHttp`; spec `@fabric/core` `docs/PASSPORT.md`) replaces site login, the delegation registry, and `fabric://login` polling. Findings it closes:
   - **Host-derived origin (M2):** origins are pinned; an empty list refuses to start in production and allows loopback only elsewhere.
   - **Nonce in a cookie (L1):** the cookie holds a 32-byte binding secret; the store is keyed by its sha256, so a lifted assertion can't be redeemed from another browser.
   - **Check-then-delete redeem (L2):** `redeem` takes the record atomically before verifying, so concurrent redeems can't both succeed.
   - **Cross-device phishing (L3):** there is no deep link or QR login, and no Hub `/sessions` broker for other origins.
   - **Session tokens at rest:** stored as sha256(token). A native client (`X-Fabric-Native: 1`, no `Origin`) gets a Bearer token; a browser request never does.
   - **Hub self-sign** is `POST /sessions/self`, off unless the host passes `selfSign`, from a direct loopback socket without proxy headers whose `Origin` is one of the host's `selfOrigins`; entries that are not loopback origins are ignored, so a pinned public origin can never self-sign.
   - **Local delegate** (`functions/fabricDelegate`, replacing the local signer): loopback callers with an extension `Origin` only; requests only from the origin a grant from the requester records or the app configures; pairing shows a commit-then-reveal code on both screens before any grant; pairing prompts at most every 30 s; requests deduplicated by frame hash in the app's own message store; disclosures only when the challenge asked.
   - **Pairing rendezvous and mailbox** (`functions/fabricDelegationHttp`: `createDelegationRendezvous`, `createDelegationMailbox`): carry signed frames only and check each against core before keeping it; a rendezvous can drop a pairing but not forge one, and a mailbox is read only with a fresh fetch frame signed by the addressee.
   Tests: `tests/passportRelyingParty.test.js`, `tests/passportHttp.test.js`, `tests/fabricDelegation.test.js`.
10. **PR #69 auth boundary** — device-link origins are canonicalized for replay keys (`offerReplayKey` + create path); peer host parsing is IPv6-safe and rejects ports outside **1..65535**. Device-link DELETE off loopback requires `pollSecret` via `X-Fabric-Poll-Secret` only (`?pollSecret=` is ignored). Device links are `fabric:device-link:3` only: offer and link name the session, nonce, and origin and are signed under `Fabric/DeviceLinkOffer` / `Fabric/DeviceLink`; v1 and v2 no longer parse. Remaining: device-link GET `linked` stays Origin-gated for the QR responder. Own-host DNS uses `dns.promises.lookup` (cached).
11. **Follow-up (ops):** keep `package.json` on `FabricLabs/fabric#feature/channels` during development, but **re-pin releases** to the lockfile SHA (`1ba3b3cd` as of 2026-10-24). `npm run report:install` removes `package-lock.json` then `npm i --allow-git=all` — bump the tip with `npm install FabricLabs/fabric#feature/channels --allow-git=all` (or pin a SHA) when core moves.

### PR #69 review triage (`feature/rsi`)

Latest automation security review still flags Origin as insufficient — signed redeem now uses `pollSecret`. Core pin refreshed to `ff7c05c5` ([core #186](https://github.com/FabricLabs/fabric/pull/186): `Tree#verifyInclusion` no longer lets the prover choose the commitment, NOISE `onverify` will not restore a freed pointer, `frameId` hex validation, `Store#flush` during deferred open; earlier [core #185](https://github.com/FabricLabs/fabric/pull/185): IdentityCrossSign compressed 66-hex ids, `_normPubkey`, candidate-retry bound, NOISE teardown, Filesystem publish retain cut, file-count fold). Stale PR threads still describe Hub self-sign default-on and `wss:` origin bypass — both are **fixed** in this tree. JSONCall unauthorized-hash / watch-only `signWithKey`, peer port `1..65535`, 402 digest coercion, ARC type-only reject, federation `accept` boolean, and device-link `offerReplayKey` origin canonicalize threads are also **fixed** (threads remain unresolved on GitHub). CodeRabbit’s RFC6902 round-trip suggestion on `tests/messageBodyJsonBridge.test.js` is a **false positive**: the assertion matches the second constructed message (`{ a: 1 }`), not the first `rateSats` helper object. CodeRabbit 402 markup-from-`costBasisSats` is **wontfix** (privacy). `--wallet -p` is not a path.

| Item | Status |
|------|--------|
| Hub self-sign forgeable Origin | Fixed — opt-in + loopback-only |
| HTTPS-only default hub allowlist / `wss:` origin map | Fixed |
| JSONCall unauthorized hash / watch-only `signWithKey` | Fixed — correlate from frame body; sign only when `_rootKey.private` |
| `GET /sessions/:id` signed redeem via forgeable Origin | Fixed — `pollSecret` header only (`X-Fabric-Poll-Secret`; no query); pending GET stays Origin-gated |
| Relay Bearer redeem same poll gate | Fixed — same `getSession` check |
| Device-link DELETE cancel via forgeable Origin | Fixed — `pollSecret` off-loopback |
| Device-link GET attestation disclosure | Open — responder has QR `sessionId` only; pending/accepted/linked GET stay Origin-gated |
| Device-link `sessionId` bind in attest message | Fixed — `fabric:device-link:3` binds `sessionId`, server nonce, and origin under purpose tags; older versions refused |
| Shared Origin poll helper | Site-login / relays: `clientMayPollDesktopSession`. Device-link: that plus thin-client Origins on allowlisted hubs |
| `.npmrc` `allow-git=all` | Intentional — nested SHA fetches; do not flip to `root` |
| Canonical disclosure contact | Fixed — `security@fabric.pub` in README + SECURITY + AUDIT |
| Device-link replay-key origin canonicalize | Fixed — `normalizeHubOrigin` inside `offerReplayKey` |
| Peer port range `1..65535` | Fixed — `parseFabricPeerPort` / `isFabricAddress` / `normalizeFabricAddress` |
| Pin `@fabric/core` to SHA for releases | Ops — keep `#feature/rsi` until the release tag; lockfile records `ff7c05c5` |
| `extract-zip` via puppeteer | Residual — 4 high via production `puppeteer@24.37.5` (Sandbox / browser tests). `puppeteer@25.7.0` deferred. |

## Disclosure

Canonical monitored contact: **`security@fabric.pub`** (also listed in [README.md](README.md) and [SECURITY.md](SECURITY.md)). GitHub Security Advisories are an alternate private channel.
