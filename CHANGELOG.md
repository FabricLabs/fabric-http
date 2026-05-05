# Changelog
All notable changes to `@fabric/http` are documented here. This project follows semantic-ish versioning with **RC** milestones aligned to **hub.fabric.pub** and **`@fabric/core`**.

## Unreleased
- **Breaking (exports):** `types/server.js` now exports only **`FabricHTTPServer`**. Helpers previously re-exported from that module — notably **`resolveFabricHttpPackageAssetsDir`** and **`acceptFirstHtmlNavigation`** — are no longer available from `require('@fabric/http/types/server')`. Prefer **`require('@fabric/http').protocol.*`** / **`require('@fabric/http/types/web').resolveAppAssetsDir`** (and related **`types/web`** helpers), or import the underlying **`functions/*`** modules documented in **README.md**.
- **Fabric UI (Fomantic):** Vendored build uses the **`fabric`** theme package (renamed from upstream `default`) plus **Arvo** (`libraries/fomantic/src/theme.config`, `theme.less`, `themes/fabric/assets/fonts/`). Global **border radius** variables are **0** for square chrome. `npm run build:semantic` runs Gulp and mirrors `dist/` into `assets/` (including `/semantic.min.css` + `/themes/fabric/...`). **HTTPServer** still mounts package `assets/` as secondary `express.static` for downstream apps.

## [0.1.0-RC1] — 2026-03-20
- **Release engineering:** Added `npm run ci`, [docs/PRODUCTION.md](docs/PRODUCTION.md), [docs/MARKETING_OVERVIEW.md](docs/MARKETING_OVERVIEW.md), [docs/RELEASE_CHECKLIST.md](docs/RELEASE_CHECKLIST.md), and GitHub Actions CI (tests + script build).
- **Static / CLI:** `express.static` options (`cacheSeconds`, `etag`, `dotfiles`, …), optional `compression`, http-server–like CLI flags (`-p`, `-a`, `-c`, `-S` / `--spa`), optional SPA `index.html` fallback, configurable CORS, optional HTTP JSON-RPC (`jsonRpc.enabled` + `paths`) delegating to `_handleCall`; fixed `ready` callback `this` binding. Hub uses built-in JSON-RPC instead of a duplicate handler. Static `index` uses `['index.html']` (send package rejects boolean `true`). Constructor `merge()` supplies defaults for `jsonRpc`, `static`, `spaFallback*`, `cors` (on), and `compression` (on); `assets` falls back to `settings.path` when `assets` is omitted.
- **Tests:** `tests/standards.http.js` — HTML5 parse checks, `Accept` negotiation, JSON-RPC JSON Schema (AJV), RFC 6902 JSON Patch; `npm run test:standards`.

[0.1.0-RC1]: https://github.com/FabricLabs/fabric-http/compare/master...v0.1.0-RC1
