# Fabric HTTP Security Audit
Living posture notes for `@fabric/http` **0.1.0-RC1**. Re-run **`npm audit`** after dependency changes; keep this file aligned with the current lockfile.

## Status (2026-08-06)

| Area | Posture |
|------|---------|
| `@fabric/core` | Git pin `FabricLabs/fabric#feature/rsi` (aligned with local reference client / Node **24.15.0**) |
| npm `allow-git` | **`.npmrc` `allow-git=all`** — nested git-dep preparation resolves core to a commit SHA; `root` is refused |
| WebSocket (`ws`) | **Mitigated** — direct + override **`8.21.2`** (GHSA-58qx-3vcg-4xpx / fragment DoS) |
| Express / body-parser / qs | **Mitigated** — `express@4.22.2`, `body-parser@1.20.6`, override `qs@6.15.3` |
| undici (fomantic → `@actions/http-client`) | **Mitigated** — override **`6.28.0`** |
| Markdown (SLIP-0044 script) | **Mitigated** — replaced `showdown` (unfixed ReDoS GHSA-rmmh-p597-ppvv) with **`marked@15.0.12`** |
| PeerJS / browser mesh | **Removed** — `types/swarm.js` is a no-op stub; Hub native WebRTC |
| npm audit (clean tree) | **0 vulnerabilities** after 2026-08-06 pin/override pass |

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

```
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

1. After dependency edits: **`npm ci`** (or `npm i`) then **`npm audit`** and **`npm test`**.
2. Keep **`engines.node`** at **24.15.0** with Hub / `@fabric/core`.
3. Do not reintroduce **peerjs** or **showdown**.
4. Treat Fomantic gulp as **build-only**; never expose its admin GitHub tooling on production HTTP paths.
5. Coordinate `@fabric/core` bumps with Hub (`npm run link:fabric` / git pin) so Message/Peer/opcode behavior stays aligned.

## Disclosure

Report vulnerabilities per project README / `security@fabric.pub` where listed in operator docs.
