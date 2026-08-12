# Changelog
All notable changes to `@fabric/http` are documented here. This project follows semantic-ish versioning with **RC** milestones aligned to **hub.fabric.pub** and **`@fabric/core`**.

## Unreleased
- **Dependencies / security:** Clear **`npm audit`** (0 findings). Runtime pins: `ws@8.21.2`, `express@4.22.2`, `body-parser@1.20.6`, `express-session@1.19.0`, `webpack@5.109.2`. Overrides: `qs@6.15.3`, `body-parser`, `ws`, patched `@octokit/request@8.4.1` / `request-error@5.1.1` / `plugin-paginate-rest@9.2.2`, `@actions/http-client` → `undici@6.28.0`. Replace unfixed `showdown` with `marked@15.0.12` (`scripts/slip-0044.js`). Dev: `mocha@11.8.0` (stable), `ajv@8.20.0`. See [AUDIT.md](AUDIT.md).
- **`@fabric/core` pin:** Declared as commit **`2faffae58bdecc2d14896dfbac70de03cba8323a`** (not moving `feature/rsi`). Local monorepo work may `npm link @fabric/core`.
- **Device link:** `functions/fabricDeviceLinkHttp.js` requires `@fabric/core` `Key` / `Identity` (create/sign no longer throw `ReferenceError` masked as invalid xpub).
- **npm git deps:** `.npmrc` / `report:install` use **`allow-git=all`** because nested `@fabric/core` lockfile preparation resolves a **commit SHA** (not only a branch tip); npm 12’s `allow-git=root` still refuses that nested SHA prepare step. See [AUDIT.md](AUDIT.md).
- **SLIP-0044:** `scripts/slip-0044.js` fetches a **pinned commit** of `slip-0044.md` (not `master`).
- **Engines:** Node pinned to **`24.15.0`** (aligned with `@fabric/core` / Hub).
- **Docs:** `docs/MESSAGE_SPEC.md` — mesh relay is bit-identical `P2P_RELAY` (no hop re-sign); onion remains Peer-terminated.
- **Breaking (exports):** `types/server.js` now exports only **`FabricHTTPServer`**. Helpers previously re-exported from that module — notably **`resolveFabricHttpPackageAssetsDir`** and **`acceptFirstHtmlNavigation`** — are no longer available from `require('@fabric/http/types/server')`. Prefer **`require('@fabric/http').protocol.*`** / **`require('@fabric/http/types/web').resolveAppAssetsDir`** (and related **`types/web`** helpers), or import the underlying **`functions/*`** modules documented in **README.md**.
- **Fabric UI (Fomantic):** Vendored build uses the **`fabric`** theme package (renamed from upstream `default`) plus **Arvo** (`libraries/fomantic/src/theme.config`, `theme.less`, `themes/fabric/assets/fonts/`). Global **border radius** variables are **0** for square chrome. `npm run build:semantic` runs Gulp and mirrors `dist/` into `assets/` (including `/semantic.min.css` + `/themes/fabric/...`). **HTTPServer** still mounts package `assets/` as secondary `express.static` for downstream apps.

## [0.1.0-RC1] — 2026-03-20
- **Release engineering:** Added `npm run ci`, [docs/PRODUCTION.md](docs/PRODUCTION.md), [docs/MARKETING_OVERVIEW.md](docs/MARKETING_OVERVIEW.md), [docs/RELEASE_CHECKLIST.md](docs/RELEASE_CHECKLIST.md), and GitHub Actions CI (tests + script build).
- **Static / CLI:** `express.static` options (`cacheSeconds`, `etag`, `dotfiles`, …), optional `compression`, http-server–like CLI flags (`-p`, `-a`, `-c`, `-S` / `--spa`), optional SPA `index.html` fallback, configurable CORS, optional HTTP JSON-RPC (`jsonRpc.enabled` + `paths`) delegating to `_handleCall`; fixed `ready` callback `this` binding. Hub uses built-in JSON-RPC instead of a duplicate handler. Static `index` uses `['index.html']` (send package rejects boolean `true`). Constructor `merge()` supplies defaults for `jsonRpc`, `static`, `spaFallback*`, `cors` (on), and `compression` (on); `assets` falls back to `settings.path` when `assets` is omitted.
- **Tests:** `tests/standards.http.js` — HTML5 parse checks, `Accept` negotiation, JSON-RPC JSON Schema (AJV), RFC 6902 JSON Patch; `npm run test:standards`.

[0.1.0-RC1]: https://github.com/FabricLabs/fabric-http/compare/master...v0.1.0-RC1
