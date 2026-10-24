# Production — `@fabric/http`
`@fabric/http` is the **HTTP/WebSocket layer** for Fabric apps: `HTTPServer`, SPA hosting, WebSocket `JSONCall`, and static asset patterns shared by Fabric apps.

## Pre-flight
| Step | Command |
|------|---------|
| Install | `npm ci` |
| Release gate | `npm run ci` — runs tests and compiles scripts (`build:scripts`). |
| Standards-only (optional) | `npm run test:standards` — HTML negotiation, JSON-RPC schema, JSON Patch ([`tests/standards.http.js`](../tests/standards.http.js)); also included in `npm test`. |
| Full build (local) | `npm run build` — tests + scripts + JSDoc docs. |

## Consuming in production
- **Pin versions** — Depend on a **tagged** or **semver** release of `@fabric/http` and matching **`@fabric/core`** (see sibling [fabric](https://github.com/FabricLabs/fabric) repo). Apps may pin `FabricLabs/fabric-http#branch` during RC; align the `@fabric/http`, `@fabric/core`, and app branches when integrating.
- **TLS** — Terminate TLS in front of any server built with this library (reverse proxy or platform load balancer).
- **WebSocket** — Ensure proxies pass **Upgrade** correctly and set reasonable **idle timeouts** for long-lived JSON-RPC sessions.
- **Secrets** — Session secrets, API keys, and Fabric seeds belong in **environment** or a secrets manager, not in repo config.
- **Federation / Beacon** — When a hub configures `FABRIC_DISTRIBUTED_FEDERATION_VALIDATORS`, sidechain patches and Beacon epochs require Schnorr **`federationWitness`** (k-of-n BIP340 accumulate). HTTP binders expose optional **`GET|POST /services/distributed/epoch/signatures`** for pending rounds / signature submit (same surface as RPC `ListPendingBeaconEpochSignatures` / `SubmitBeaconEpochSignature`). Proof model: [@fabric/core `SIGNATURE_PROOF_MODEL.md`](https://github.com/FabricLabs/fabric/blob/feature/rsi/docs/SIGNATURE_PROOF_MODEL.md).

## Stack position
```text
Browser / legacy web  →  @fabric/http (this repo)  →  @fabric/core  →  bitcoind / network
                              ↑
                      apps (hubs, relays, …)
```

**Document / payment hash binding** (inventory HTLC, purchase invoices) is implemented in **`@fabric/core/functions/publishedDocumentEnvelope`** — see [fabric `docs/PAYMENTS_DOCUMENT_BINDING.md`](https://github.com/FabricLabs/fabric/blob/main/docs/PAYMENTS_DOCUMENT_BINDING.md).

## References
| Doc | Purpose |
|-----|---------|
| [README.md](../README.md) | Install & quick start |
| [core TYPES_AND_SERVICES.md](https://github.com/FabricLabs/fabric/blob/feature/rsi/docs/TYPES_AND_SERVICES.md) | Suite `types/` + `services/` homes (this package is HTTP/SPA only) |
| [core SIGNATURE_PROOF_MODEL.md](https://github.com/FabricLabs/fabric/blob/feature/rsi/docs/SIGNATURE_PROOF_MODEL.md) | Signatures authorize; L1 observes |
| [MARKETING_OVERVIEW.md](MARKETING_OVERVIEW.md) | Positioning & copy |
| [RELEASE_CHECKLIST.md](RELEASE_CHECKLIST.md) | Tag, publish, pre-release verification |
