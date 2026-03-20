# Release checklist — `@fabric/http`
Use before tagging **v0.1.0-RC1** (or subsequent RCs/releases).

- [ ] `git pull` and clean working tree on the release branch.
- [ ] `npm ci`
- [ ] `npm run ci` (tests + `build:scripts`).
- [ ] Optionally `npm run build` for full JSDoc output.
- [ ] Update **CHANGELOG.md** with version, date, and notable changes.
- [ ] Bump **version** in `package.json` if needed.
- [ ] Align **`@fabric/core`** peer/dependency ref with [fabric](https://github.com/FabricLabs/fabric) release branch when cutting a coordinated RC (Hub depends on **`functions/publishedDocumentEnvelope`** for document/payment binding).
- [ ] Tag: `git tag -a v0.1.0-RC1 -m "…"` and push tags.
- [ ] Publish **npm** (if applicable) or document **GitHub install** SHA/branch for downstream (Hub).
