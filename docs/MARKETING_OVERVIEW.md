# Marketing overview — `@fabric/http`

## One-line pitch

**`@fabric/http`** brings Fabric to the **legacy web**: HTTP servers, **WebSocket JSON-RPC**, and SPA patterns so browsers and edge nodes can talk to **`@fabric/core`** without reinventing transport.

## Three bullets

1. **Edge-ready** — Same primitives Hub uses for WebSocket bridge, static assets, and structured RPC.
2. **Fabric-aligned** — Designed to track **`@fabric/core`** message types and HTTP behavior; develop with `npm install ../fabric --no-save` when both repos are local.
3. **Release-gated** — `npm run ci` (tests + script build) before tags; see [PRODUCTION.md](PRODUCTION.md).

## Ecosystem placement

| Package | Role |
|---------|------|
| **`@fabric/core`** | P2P, `Message`, `Key`, Bitcoin/Lightning services, contracts |
| **`@fabric/http`** (this) | HTTP + WebSocket server/client for web and edge |
| **hub.fabric.pub** | Full operator app + Bitcoin UX + document/payment flows |

## Release status

**0.1.0-RC1** — experimental; verify with `npm run ci` before production deploys of apps that depend on this package.

## Links

- [README.md](../README.md)
- [PRODUCTION.md](PRODUCTION.md)
- [CHANGELOG.md](../CHANGELOG.md)
