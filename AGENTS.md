# fabric-http — Agent Guidelines

## Fabric ecosystem workflow (shared)
This repo is **2 of 6 — @fabric/http (depends on core)** in the Fabric dependency order. Before installing or testing, read [docs/agents/](docs/agents/README.md):
- **Install** with `npm run report:install` (fresh lock, latest Git pins; log in `reports/install.log`).
- **Strictly serial:** one install or test run at a time across all Fabric repos, top down (core → http → discord → hub → passport → star-citizen). Stop on upstream failure.
- **Consolidate** into common APIs; Core messaging stays free of HTTP, HTTP is an adapter ([API_CONSOLIDATION.md](docs/agents/API_CONSOLIDATION.md)).
