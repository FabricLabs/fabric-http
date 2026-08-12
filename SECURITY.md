# Security (`@fabric/http`)
HTTP / WebSocket gateway for Fabric peers and browser clients.

## Adversarial environment
Fabric networks are intended for deployment where **peers, relays, hubs, and operators may be hostile**. Design and review against:

- Untrusted TCP / WebSocket / WebRTC neighbors (forgery, replay, amplification, pin hijack)
- Phishing of identity flows (`fabric://login`, device-link) toward attacker-controlled hubs
- Public observability of unsigned or plaintext application traffic unless an explicit seal is used
- No reliance on an “honest majority” of random internet peers for key custody

This package fails closed on missing auth secrets, enforces Hub origin allowlists for site-login / device-link completion, and treats shared HTTP bind as an explicit operator choice.

**Basics coverage:** [`tests/adversarialEnvironment.basics.test.js`](tests/adversarialEnvironment.basics.test.js). Broader auth / WS hardening: [`tests/security.auth.server.js`](tests/security.auth.server.js).

## Hub allowlist
`functions/fabricHubAllowlist.js` — default network hubs + loopback; extras via `FABRIC_HUB_ALLOWLIST`. Unknown origins must not receive signed login/link completions.

## Process
1. `npm test` before merging HTTP/auth changes.
2. Never commit seeds, admin tokens, or production `stores/`.
3. Prefer loopback HTTP unless shared mode is intentional.

## Disclosure
Report security issues privately to the maintainers (GitHub Security Advisories /
private maintainer contact in README) rather than opening a public issue with
exploit details. Expect an initial response within a few business days.
