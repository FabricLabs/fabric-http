# PR security replies — fabric-http (draft, not posted)

Staged on `feature/passport` (not committed). Status keys: fixed (staged) · removed in V1 ·
already fixed · not applicable · needs a decision.

Stack: #84 `feature/passport` → #82 `feature/fomantic` → #81 `feature/channels` → `master`.
#83 `feature/passport-v2` is an ancestor of `feature/passport`, so #84 contains it. "Already
fixed" below means fixed at the #84 tip `6074c23`; for #83 and #81 that is further up the stack,
not on the PR's own branch.

## #84 feature/passport

### r4427086402 — functions/fabricDelegate.js:275 — already fixed
https://github.com/FabricLabs/fabric-http/pull/84#discussion_r4427086402

> Already fixed at `6074c23`: in `functions/fabricDelegate.js` an offer is refused while
> `linkWaiting` is set or within 30 s of the last prompt, `linkOrigins` is cleared on every
> offer, and the reveal check and `linkWaiting` flag are set synchronously before any await.
> The staged change also checks the reveal's origin before the frame is taken (see F9).

### r4442083492 — functions/pageRouter.js:83 — already fixed
https://github.com/FabricLabs/fabric-http/pull/84#discussion_r4442083492

> Already fixed at `6074c23`: `start()` in `functions/pageRouter.js` installs the click handler,
> and `linkPath` leaves modifier-key clicks, `target`, `download`, `rel=external`,
> cross-origin, and hash-only links to the browser.

### r4442083505 — package.json:210 — needs a decision
https://github.com/FabricLabs/fabric-http/pull/84#discussion_r4442083505

> Confirmed: the `minimatch` override only applies when this repo installs itself; consumers
> still resolve `minimatch` 10.x through `@fabric/core` → `ts-morph` → `@ts-morph/common`.
> It is only reachable with attacker-supplied glob patterns. Needs a decision: move `ts-morph`
> to `devDependencies` in `@fabric/core` (then drop this override), or ship an
> `npm-shrinkwrap.json` here?

### r4478005364 — types/spa.js:144 — already fixed
https://github.com/FabricLabs/fabric-http/pull/84#discussion_r4478005364

> Already fixed at `6074c23`: `types/spa.js` creates the state entry with
> `if (this._state.content[address] == null) this._state.content[address] = {};` before using it.

### r4497703345 — functions/passportPeer.js:345 — fixed (staged)
https://github.com/FabricLabs/fabric-http/pull/84#discussion_r4497703345

> Fixed in `functions/passportPeer.js`: the replay cache is now per session, not per
> connection. `sessionFrames` (sessionId → frames seen) is shared by every connection the
> session is bound on, so a frame captured on one socket speaks for nobody after a
> `PASSPORT_RESUME` or on a second bound socket. At the cap (`maxFramesPerSession`, 65,536) the
> session is marked full and refused (`passport_replay_limit`), resuming is refused, and the
> user signs in again; the cache is never cleared into a replayable state. Covered by
> `tests/passportPeer.test.js` ("remembers the frames a session spoke across connections").

### r4503964972 — functions/passportPeer.js:345 — fixed (staged)
https://github.com/FabricLabs/fabric-http/pull/84#discussion_r4503964972

> Fixed in `functions/passportPeer.js`, same change as r4497703345: seen frames are kept per
> session until the session expires or is revoked (`revoke` drops them), and a full session
> refuses further frames and resumes instead of clearing. A signed `expiresAt` inside each
> session-signed frame, to bound the cache by time, is a follow-up.

## #83 feature/passport-v2

### r4379127097 — CHANGELOG.md:7 — already fixed
https://github.com/FabricLabs/fabric-http/pull/83#discussion_r4379127097

> Already fixed at `6074c23` (#84, which contains this branch): the device-link and
> `SITE_LOGIN_RESPONSE` entry is gone, `docs/OUTSTANDING.md` marks device links and site login
> as removed, and the CHANGELOG describes only the OracleAttestation signing purpose. We plan
> to close #83 as superseded by #84.

### r4379127124 — functions/passportRelyingParty.js:63 — fixed (staged)
https://github.com/FabricLabs/fabric-http/pull/83#discussion_r4379127124

> Fixed in `functions/passportRelyingParty.js` and `functions/passportHttp.js`. At `6074c23`
> challenge issuance was already rate-limited and `put` refuses (503) instead of evicting;
> the staged change also caps unredeemed challenges per client (8, freed on redeem or expiry,
> 429 past it), so one client can no longer fill the store. Covered by
> `tests/passportRelyingParty.test.js` and `tests/passportHttp.test.js`.

### r4427107588 — functions/passportRelyingParty.js:62 — fixed (staged)
https://github.com/FabricLabs/fabric-http/pull/83#discussion_r4427107588

> Fixed in `functions/passportRelyingParty.js`: besides the per-client challenge cap, an
> identity now holds at most 16 live sessions (`sessionsPerIdentity`), and a new sign-in ends
> that identity's oldest session, so signing in repeatedly with your own key can't push out
> anyone else. `createMemoryStore.put` now sweeps expired rows only when the store is full.
> The global 503 stays as the last resort.

### r4429570370 — CHANGELOG.md:6 — already fixed
https://github.com/FabricLabs/fabric-http/pull/83#discussion_r4429570370

> Already fixed on this branch: the CHANGELOG no longer mentions `fabricLocalSigner` and says
> the local signer is replaced by delegation (`fabricDelegate`).

### r4429570375 — functions/delegationHttpBody.js:21 — already fixed
https://github.com/FabricLabs/fabric-http/pull/83#discussion_r4429570375

> Already fixed at `6074c23` (#84): body reading moved to `readRequestText` in
> `functions/httpRequestTrust.js`, which tests `readableEnded || readable === false` and never
> `req.complete`. #83 is superseded by #84.

### r4429570384 — functions/fabricDelegationMailbox.js:69 — already fixed
https://github.com/FabricLabs/fabric-http/pull/83#discussion_r4429570384

> Already fixed at `6074c23` (#84): the mailbox in `functions/fabricDelegationHttp.js` caches
> the `loading` promise, resets it and answers 503 when a load fails, and skips `save()` until
> the mailbox has loaded, so a failed load can't overwrite the persisted boxes.

### r4429570389 — functions/fabricDelegationMailbox.js:179 — already fixed
https://github.com/FabricLabs/fabric-http/pull/83#discussion_r4429570389

> Already fixed at `6074c23` (#84): GET is gated by `fetchLimit` (6× the post budget) in
> `functions/fabricDelegationHttp.js`, and spent proofs are swept by expiry. The staged change
> also shares one spent-proof set between the mailbox and the rendezvous.

### r4429570394 — package.json:34 — already fixed
https://github.com/FabricLabs/fabric-http/pull/83#discussion_r4429570394

> Already fixed at `6074c23` (#84): `scripts/example-tutorials.js` exists there, so
> `example:tutorials` runs.

## #81 feature/channels

### r4366960855 — types/server.js:2034 — already fixed
https://github.com/FabricLabs/fabric-http/pull/81#discussion_r4366960855

> Already fixed further up the stack at `6074c23` (#84): `types/server.js` refuses a blob route
> that overlaps the resource's own view or list route, and the blob 405 runs before resource
> delegation, so PUT/PATCH/DELETE never reach the generic handlers. If #81 merges before #84,
> it needs that self-overlap refusal ported.

### r4369620430 — API.md:131 — already fixed
https://github.com/FabricLabs/fabric-http/pull/81#discussion_r4369620430

> Already fixed at `6074c23` (#84): the `types/resource.js` JSDoc documents the 400 from
> `_getBlob`, and `API.md` was regenerated to match.

### r4369620433 — components/document.js:43 — already fixed
https://github.com/FabricLabs/fabric-http/pull/81#discussion_r4369620433

> Already fixed at `6074c23` (#84): the component passes
> `view.sanitizeRecord(this.settings.document)` to `_buyBlob`, never the raw record.

### r4369620439 — tests/document.component.unit.js:378 — already fixed
https://github.com/FabricLabs/fabric-http/pull/81#discussion_r4369620439

> Already fixed at `6074c23` (#84): the test sets `this.timeout(20000)`.

## Fresh findings

- **F1** — High — fixed (staged). Signed-call replay across connections: `passportPeer.js`
  keeps seen frames per session across connections, refuses (never clears) at the cap, and
  refuses resume once full. Left: a signed `issuedAt`/`expiresAt` in each frame so the cache is
  bounded by time.
- **F2** — Medium — needs a decision. Mailbox-fetch proofs carry no audience or purpose.
  Staged: one process-wide spent-proof set shared by the rendezvous and mailbox in
  `fabricDelegationHttp.js`, so a proof spent on a mailbox read can't cancel a pairing on the
  same Hub (test in `tests/fabricDelegation.test.js`). Left: `audience` + `purpose` in the core
  `DELEGATION_MAILBOX_FETCH` schema (a v2 of the proof), which stops cross-Hub replay.
- **F3** — Medium — fixed (staged). Relying-party global-cap denial of service: per-client
  pending-challenge cap (8), per-identity session cap (16, oldest of that identity ends), and
  `put` sweeps only when full.
- **F4** — Medium — needs a decision. `@fabric/core` is still the mutable branch
  `FabricLabs/fabric#feature/schemas` in `dependencies`; pin to a tag or SHA before V1.
- **F5** — Low–Medium — needs a decision. Consumers still get `minimatch` 10.x via
  `@fabric/core` → `ts-morph` (same as r4442083505).
- **F6** — Low — needs a decision. No default WebSocket origin check when
  `websocket.verifyOrigin` is unset; nothing staged.
- **F7** — Low — needs a decision. No default `frame-ancestors` / CSP on SPA HTML; nothing
  staged.
- **F8** — Low — fixed (staged). `createRateLimit` in `httpRequestTrust.js` re-inserts each
  renewed window at the end and prunes expired windows from the front on every renewal, so the
  map no longer grows until 4096 entries.
- **F9** — Low — fixed (staged). `fabricDelegate.js` reads the reveal and checks that it
  answers an offer started from the same origin before `store.receive` takes it; a reveal from
  another origin is refused without consuming the pairing (test in
  `tests/fabricDelegation.test.js`).
- **F10** — Low — needs a decision. The unstaged `package.json` in this working tree (another
  session's change) still adds an `http` bin; it should stay out of any commit.

## Side and stale PRs

- #83 `feature/passport-v2` — close: superseded by #84, which contains it and fixes its threads.
- #82 `feature/fomantic` — fold into the stack: no open threads; merges with #84.
- #81 `feature/channels` — fold into the stack: all four threads are fixed at the #84 tip; port them only if #81 merges alone.
- #55 CodeRabbit auto-fixes for #54 — close: patches only generated `docs/*.html`, the real timing-safe compare is already in `types/server.js`, and its puppeteer 24 → 23 downgrade must not be taken.
- #59 @babel/plugin-transform-modules-systemjs 7.29.4 — close: superseded, `feature/passport` is on Babel 8.
- #60 js-cookie 3.0.7 — close: superseded, resolves 3.0.8.
- #62 qs 6.15.2 / body-parser / express — close: superseded, on Express 5, body-parser 2.4.0, qs 6.17.1.
- #63 markdown-it 14.2.0 — close: superseded, resolves 14.3.3.
- #64 ws 8.21.0 — close: superseded, resolves 8.22.1 (nested 7.5.13 past the DoS fix).
- #66 undici 7.28.0 — close: superseded, resolves 8.12.4.
- #67 @babel/core 7.29.7 — close: superseded, on Babel 8.
- #70 js-yaml 4.3.0 — close: superseded, resolves 4.3.2.
- #71 linkify-it 5.0.2 — close: superseded, already resolves 5.0.2.
- #73 body-parser 1.20.6 — close: superseded, on 2.4.0 with no 1.x copy.
- #74 tar 7.5.22 — close: superseded, tar is no longer in the tree.
- #75 postcss 8.5.23 — close: superseded, resolves 8.5.32.
- #76 brace-expansion 5.0.9 / 2.1.4 — close: superseded, resolves 5.0.12 and the patched 1.1.21; no 2.x.
- #77 ip-address 10.4.0 — close: superseded, no longer in the tree.
- #78 fast-uri 3.1.5 — close: superseded, resolves 3.1.9.

## Needs a decision

- Add a signed `issuedAt`/`expiresAt` to session-signed Passport peer frames so the replay cache is bounded by time (F1 follow-up)?
- Add `audience` and `purpose` to the core `DELEGATION_MAILBOX_FETCH` proof (schema v2), then require them in `fabricDelegationHttp.js` (F2)?
- Pin `@fabric/core` to a tag or commit SHA instead of `#feature/schemas` before V1 (F4)?
- Fix `minimatch` for consumers by moving `ts-morph` to `devDependencies` in `@fabric/core`, or ship an `npm-shrinkwrap.json` here (F5, r4442083505)?
- Default the WebSocket origin check to the pinned Passport origins when `verifyOrigin` is unset, or document it as required (F6)?
- Add a default `frame-ancestors 'self'` to SPA HTML responses (F7)?
- Keep the uncommitted `http` bin out of `package.json` when that session commits (F10)?
- Close #83 as superseded by #84?
