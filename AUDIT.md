# Fabric HTTP Security Audit
Living posture notes for `@fabric/http` **0.1.0-RC1**. Re-run **`npm audit`** after dependency changes; keep this file aligned with the current lockfile.

## Status (2026-08-14)

| Area | Posture |
|------|---------|
| `@fabric/core` | Git pin `FabricLabs/fabric#feature/rsi` (lockfile SHA `0ed61d62057e1bee719a19941201eeecd66ca864`; Node **24.15.0**) |
| npm `allow-git` | **`.npmrc` `allow-git=all`** — nested git-dep preparation resolves core to a commit SHA; `root` is refused (intentional — do not flip to `root`) |
| WebSocket (`ws`) | **Mitigated** — direct + override **`8.21.2`** (GHSA-58qx-3vcg-4xpx / fragment DoS) |
| Express / body-parser / qs | **Mitigated** — `express@4.22.2`, `body-parser@1.20.6`, override `qs@6.15.3` |
| undici (fomantic → `@actions/http-client`) | **Mitigated** — override **`6.28.0`** |
| Markdown (SLIP-0044 script) | **Mitigated** — replaced `showdown` (unfixed ReDoS GHSA-rmmh-p597-ppvv) with **`marked@15.0.12`** |
| PeerJS / browser mesh | **Removed** — `types/swarm.js` is a no-op stub; Hub native WebRTC |
| npm audit status | **4 high** residual — `extract-zip@2.0.1` chain via production pin `puppeteer@24.37.5` / `@puppeteer/browsers` (Sandbox / `tests/browser.js`; Hub `scripts/node.js` does not import it). `puppeteer@25.7.0` is a deferred bump. Runtime `ws` / Express / undici overrides remain clean. |

## Overrides for mitigated runtime findings

| Override | Why |
|----------|-----|
| `ws@8.21.2` | Direct + transitive (incl. jayson) |
| `body-parser@1.20.6`, `qs@6.15.3` | Express request parsing |
| `undici@6.28.0` under `@actions/http-client` | Fomantic → GitHub Actions client |
| `@octokit/request@8.4.1`, `request-error@5.1.1`, `plugin-paginate-rest@9.2.2` | Fomantic gulp/admin ReDoS advisories without downgrading fomantic |

Do **not** run `npm audit fix --force` casually — it has proposed downgrading `fomantic-ui`. Prefer explicit pins/overrides and a clean `npm audit`.

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

1. After dependency edits: **`npm ci`** then **`npm audit`** and **`npm test`** against the checked-in lockfile. Use **`npm run report:install`** only when intentionally refreshing git pins (`#feature/rsi`); it wipes `node_modules` **and** `package-lock.json`, then `npm i --allow-git=all`. Diff the new lockfile before committing — do not treat the wiped lockfile as a release artifact until that review.
2. Keep **`engines.node`** at **24.15.0** with Hub / `@fabric/core`.
3. Do not reintroduce **peerjs** or **showdown**.
4. Treat Fomantic gulp as **build-only**; never expose its admin GitHub tooling on production HTTP paths.
5. Coordinate `@fabric/core` bumps with Hub (`npm run link:fabric` / git pin) so Message/Peer/opcode behavior stays aligned. Install from `FabricLabs/fabric#feature/rsi` when refreshing, then **re-pin** `package.json` to the lockfile’s resolved SHA — do not leave a moving branch tip in releases.
6. Before RC: finish GenericMessage AMP-verify / named-type migration with Hub (unauthenticated GenericMessage is already dropped locally; SLIP-0044 fetch is commit-pinned + validated; see [SECURITY.md](SECURITY.md)).
7. Follow-up (Hub / apps): core now ships Fabric BIP44 coin types **7777** (Bitcoin mainnet) / **7778** (otherwise). Align Hub account-derivation helpers that still hardcode `7778` for mainnet paths.
8. Follow-up (larger): `messageBodyJsonBridge` RFC6902 sidechain JSON → typed fields still does not preserve a full multi-op patch sequence end-to-end; keep rejecting unsupported ops and prefer Hub typed carriers until that lands.
9. Follow-up (auth polish): site-login GET looks up `_delegationRegistry` by opaque Bearer token with `timingSafeEqual` session binding + TTL/size prune. Path-as-token (`GET /sessions/:delegationToken`) also requires matching Bearer. Remaining Hub-side: ensure any dual-keyed legacy registries migrate.
10. **PR #69 auth boundary (partially closed)** — Hub self-sign is now **opt-in** (`allowHubSelfSign === true`) and **loopback-only**; LiveRelay omits unrecognized Bearer when `issueBearer` is absent; device-link origins are canonicalized for replay keys (`offerReplayKey` + create path); peer host parsing is IPv6-safe and rejects ports outside **1..65535**. Site-login / LiveRelay share `clientMayPollDesktopSession`; device-link adds thin-client Origins on allowlisted hubs (`clientMayAccessDeviceLink`). Expired-session GET `/sessions/:delegationToken` requires a matching `Authorization: Bearer` (path is not a credential). Still open on shared hosts: forgeable Origin/Referer for live session/device-link **redeem** / poll (needs possession proof); bind `sessionId` into link messages in a coordinated client bump. Own-host DNS uses `dns.promises.lookup` (cached).
11. **Follow-up (ops):** keep `package.json` on `FabricLabs/fabric#feature/rsi` during RSI development, but **re-pin releases** to the lockfile SHA (`488a87da1…` as of 2026-08-14 tip refresh). `npm run report:install` wipes `package-lock.json` then `npm i --allow-git=all` — bump the tip with `npm install FabricLabs/fabric#feature/rsi --allow-git=all` (or pin a SHA) when core moves.

### PR #69 review triage (`feature/rsi`)

Latest automation security review (`5161e76`) still flags session/device-link **redeem** as High/Medium because Origin headers are not possession proofs — not this slice (needs a coordinated possession proof). Core pin refreshed to `488a87da1…` ([core #185](https://github.com/FabricLabs/fabric/pull/185): IdentityCrossSign compressed 66-hex ids, `_normPubkey`, candidate-retry bound, NOISE teardown). Stale PR threads still describe Hub self-sign default-on and `wss:` origin bypass — both are **fixed** in this tree. JSONCall unauthorized-hash / watch-only `signWithKey`, peer port `1..65535`, 402 digest coercion, ARC type-only reject, federation `accept` boolean, and device-link `offerReplayKey` origin canonicalize threads are also **fixed** (threads remain unresolved on GitHub). CodeRabbit’s RFC6902 round-trip suggestion on `tests/messageBodyJsonBridge.test.js` is a **false positive**: the assertion matches the second constructed message (`{ a: 1 }`), not the first `rateSats` helper object. CodeRabbit 402 markup-from-`costBasisSats` is **wontfix** (privacy). `--wallet -p` is not a path.

| Item | Status |
|------|--------|
| Hub self-sign forgeable Origin | Fixed — opt-in + loopback-only |
| HTTPS-only default hub allowlist / `wss:` origin map | Fixed |
| JSONCall unauthorized hash / watch-only `signWithKey` | Fixed — correlate from frame body; sign only when `_rootKey.private` |
| `GET /sessions/:id` redeem via forgeable Origin | Open — needs possession proof (poll secret / signed challenge) |
| LiveRelay Bearer redeem same poll gate | Open — same possession proof |
| Device-link GET attestation disclosure | Open — same capability (`sessionId`); thin-client Origins allowed on allowlisted hubs only |
| Device-link `sessionId` bind in attest message | Deferred — coordinated Passport / desktop / SCL bump |
| Shared Origin poll helper | Site-login / LiveRelay: `clientMayPollDesktopSession`. Device-link: that plus thin-client Origins on allowlisted hubs |
| `.npmrc` `allow-git=all` | Intentional — nested SHA fetches; do not flip to `root` |
| Canonical disclosure contact | Fixed — `security@fabric.pub` in README + SECURITY + AUDIT |
| Device-link replay-key origin canonicalize | Fixed — `normalizeHubOrigin` inside `offerReplayKey` |
| Peer port range `1..65535` | Fixed — `parseFabricPeerPort` / `isFabricAddress` / `normalizeFabricAddress` |
| Pin `@fabric/core` to SHA for releases | Ops — keep `#feature/rsi` in RSI; lockfile records `488a87da1…` |
| `extract-zip` via puppeteer | Residual — 4 high via production `puppeteer@24.37.5` (Sandbox / browser tests). `puppeteer@25.7.0` deferred. |

## Disclosure

Canonical monitored contact: **`security@fabric.pub`** (also listed in [README.md](README.md) and [SECURITY.md](SECURITY.md)). GitHub Security Advisories are an alternate private channel.
