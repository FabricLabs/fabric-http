# Production — `@fabric/http`
`@fabric/http` is the **HTTP/WebSocket layer** for Fabric apps: `HTTPServer`, SPA hosting, WebSocket `JSONCall`, and static asset patterns used by **[hub.fabric.pub](https://github.com/FabricLabs/hub.fabric.pub)**.

## Pre-flight

| Step | Command |
|------|---------|
| Install | `npm ci` |
| Release gate | `npm run ci` — runs tests and compiles scripts (`build:scripts`). |
| Full build (local) | `npm run build` — tests + scripts + JSDoc docs. |

## Consuming in production

- **Pin versions** — Depend on a **tagged** or **semver** release of `@fabric/http` and matching **`@fabric/core`** (see sibling [fabric](https://github.com/FabricLabs/fabric) repo). Hub pins `FabricLabs/fabric-http#branch` during RC; align branches across the three repos when integrating.
- **TLS** — Terminate TLS in front of any server built with this library (reverse proxy or platform load balancer).
- **WebSocket** — Ensure proxies pass **Upgrade** correctly and set reasonable **idle timeouts** for long-lived JSON-RPC sessions.
- **Secrets** — Session secrets, API keys, and Fabric seeds belong in **environment** or a secrets manager, not in repo config.

## Stack position

```text
Browser / legacy web  →  @fabric/http (this repo)  →  @fabric/core  →  bitcoind / network
                              ↑
                    hub.fabric.pub (reference app)
```

**Document / payment hash binding** (inventory HTLC, purchase invoices) is implemented in **`@fabric/core/functions/publishedDocumentEnvelope`** — see [fabric `docs/PAYMENTS_DOCUMENT_BINDING.md`](https://github.com/FabricLabs/fabric/blob/main/docs/PAYMENTS_DOCUMENT_BINDING.md).

## References

| Doc | Purpose |
|-----|---------|
| [README.md](../README.md) | Install & quick start |
| [MARKETING_OVERVIEW.md](MARKETING_OVERVIEW.md) | Positioning & copy |
| [RELEASE_CHECKLIST.md](RELEASE_CHECKLIST.md) | Tag & publish steps |
| [hub.fabric.pub docs](https://github.com/FabricLabs/hub.fabric.pub/tree/main/docs) | Operator deploy (PRODUCTION, payments) |
