# Release checklist — `@fabric/http`
Use before tagging **v0.1.0-RC1** (or subsequent RCs/releases).

- [ ] `git pull` and clean working tree on the release branch.
- [ ] `npm ci`
- [ ] `npm run ci` (tests + `build:scripts`) — must be green in CI (`.github/workflows/ci.yml`).
- [ ] Optional: `npm run test:standards` alone for the HTTP standards suite ([`tests/standards.http.js`](../tests/standards.http.js)).
- [ ] Optionally `npm run build` for full JSDoc output.
- [ ] Update **CHANGELOG.md** with version, date, and notable changes.
- [ ] Bump **version** in `package.json` if needed.
- [ ] Align **`@fabric/core`** peer/dependency ref with [fabric](https://github.com/FabricLabs/fabric) release branch when cutting a coordinated RC (Hub depends on **`functions/publishedDocumentEnvelope`** for document/payment binding).
- [ ] Confirm **Hub** / downstream apps: `HTTPServer` settings you rely on (`jsonRpc`, `cors`, `static`, `assets` vs `path`) match [README.md](../README.md) defaults.
- [ ] Tag: `git tag -a v0.1.0-RC1 -m "…"` and push tags.
- [ ] Publish **npm** (if applicable) or document **GitHub install** SHA/branch for downstream (Hub).
