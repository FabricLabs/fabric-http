# Fabric HTTP Security Audit
Living posture notes for `@fabric/http` **0.1.0-RC1**. Re-run **`npm audit`** after dependency changes; keep this file aligned with the current lockfile.

## Status (2026-08-12)

| Area | Posture |
|------|---------|
| `@fabric/core` | Git pin `FabricLabs/fabric#51ad619c9c6ed937f586db8ca69262e2f205e2d3` (immutable SHA from `feature/rsi` tip after install; Node **24.15.0**) |
| npm `allow-git` | **`.npmrc` `allow-git=all`** — nested git-dep preparation resolves core to a commit SHA; `root` is refused (intentional — do not flip to `root`) |
| WebSocket (`ws`) | **Mitigated** — direct + override **`8.21.2`** (GHSA-58qx-3vcg-4xpx / fragment DoS) |
| Express / body-parser / qs | **Mitigated** — `express@4.22.2`, `body-parser@1.20.6`, override `qs@6.15.3` |
| undici (fomantic → `@actions/http-client`) | **Mitigated** — override **`6.28.0`** |
| Markdown (SLIP-0044 script) | **Mitigated** — replaced `showdown` (unfixed ReDoS GHSA-rmmh-p597-ppvv) with **`marked@15.0.12`** |
| PeerJS / browser mesh | **Removed** — `types/swarm.js` is a no-op stub; Hub native WebRTC |
| npm audit (clean tree) | **0 vulnerabilities** after 2026-08-12 refresh against core `51ad619c…` |

## Overrides that keep the build tree clean

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

1. After dependency edits: **`npm ci`** (or `npm i`) then **`npm audit`** and **`npm test`**. Prefer **`npm ci`** for reproducible installs; `npm run report:install` removes `node_modules` only and **keeps** `package-lock.json`.
2. Keep **`engines.node`** at **24.15.0** with Hub / `@fabric/core`.
3. Do not reintroduce **peerjs** or **showdown**.
4. Treat Fomantic gulp as **build-only**; never expose its admin GitHub tooling on production HTTP paths.
5. Coordinate `@fabric/core` bumps with Hub (`npm run link:fabric` / git pin) so Message/Peer/opcode behavior stays aligned. Install from `FabricLabs/fabric#feature/rsi` when refreshing, then **re-pin** `package.json` to the lockfile’s resolved SHA — do not leave a moving branch tip in releases.
6. Before RC: finish GenericMessage AMP-verify / named-type migration with Hub (unauthenticated GenericMessage is already dropped locally; SLIP-0044 fetch is commit-pinned + validated; see [SECURITY.md](SECURITY.md)).
7. Follow-up (Hub / apps): core now ships Fabric BIP44 coin types **7777** (Bitcoin mainnet) / **7778** (otherwise). Align Hub account-derivation helpers that still hardcode `7778` for mainnet paths.
8. Follow-up (larger): `messageBodyJsonBridge` RFC6902 sidechain JSON → typed fields still does not preserve a full multi-op patch sequence end-to-end; keep rejecting unsupported ops and prefer Hub typed carriers until that lands.
9. Follow-up (auth polish): site-login GET now looks up `_delegationRegistry` by opaque Bearer token (not path `sessionId`) with `timingSafeEqual` session binding + TTL/size prune matching desktop sessions. Remaining Hub-side: ensure any dual-keyed legacy registries migrate; prefer never returning path `sessionId` as the credential.
10. **PR #69 auth boundary (partially closed)** — Hub self-sign is now **opt-in** (`allowHubSelfSign === true`) and **loopback-only**; LiveRelay omits unrecognized Bearer when `issueBearer` is absent; device-link origins are canonicalized for replay keys (`offerReplayKey` + create path); peer host parsing is IPv6-safe. Still open on shared hosts: forgeable Origin/Referer for session/device-link **redeem** / poll (needs possession proof); bind `sessionId` into link messages in a coordinated client bump; async DNS self-check (`dns.promises.lookup`) to replace sync `lookupSync`.
11. **Follow-up (ops):** keep `package.json` on `FabricLabs/fabric#feature/rsi` during RSI development, but **re-pin releases** to the lockfile SHA (`51ad619c…` as of 2026-08-12 tip refresh). Plain `npm run report:install` keeps `package-lock.json` — bump the tip with `npm install FabricLabs/fabric#feature/rsi --allow-git=all` (or pin a SHA) when core moves.

### PR #69 review triage (`feature/rsi`)

Latest automation security review (HEAD `1cdbd8f…` + staged follow-ups) still flags 2 High + 2 Medium that need a coordinated product change (not a one-line patch):

| Item | Status |
|------|--------|
| Hub self-sign forgeable Origin | Fixed — opt-in + loopback-only |
| HTTPS-only default hub allowlist / `wss:` origin map | Fixed |
| `GET /sessions/:id` redeem via forgeable Origin | Open — needs possession proof (poll secret / signed challenge) |
| LiveRelay Bearer redeem same poll gate | Open — same possession proof |
| Device-link GET attestation disclosure | Open — same gate / possession proof |
| Device-link `sessionId` bind in attest message | Deferred — coordinated Passport / desktop / SCL bump |
| `.npmrc` `allow-git=all` | Intentional — nested SHA fetches; do not flip to `root` |
| Canonical disclosure contact | Fixed — `security@fabric.pub` in README + SECURITY + AUDIT |
| Device-link replay-key origin canonicalize | Fixed — `normalizeHubOrigin` inside `offerReplayKey` |
| Pin `@fabric/core` to SHA for releases | Ops — keep `#feature/rsi` in RSI; lockfile records `51ad619c…` |

## Disclosure

Canonical monitored contact: **`security@fabric.pub`** (also listed in [README.md](README.md) and [SECURITY.md](SECURITY.md)). GitHub Security Advisories are an alternate private channel.
