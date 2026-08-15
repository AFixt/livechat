# ADR-0011: Accept JWT access + refresh tokens in console localStorage (time-limited)

- **Status:** Accepted
- **Date:** 2026-08-15
- **Deciders:** Karl Groves
- **Risk owner:** Karl Groves
- **Review by:** 2027-02-15 (or sooner — see "Conditions that force a
  revisit")

## Context

The support console (`ui/`) persists the JWT **access token** and the
**refresh token** to `localStorage`, via Zustand's `persist` middleware keyed
`livechat.auth` (`ui/src/store/auth.ts`). The comment there records the intent:
"Persisted to localStorage so refreshes don't immediately log out." The token is
read back on every request by the axios interceptor
(`ui/src/services/api.ts`) and on socket connect (`ui/src/services/socket.ts`).

Issue #59 flags this against the `secure-project-baseline` (spec.md §16
"auth tokens are not stored in localStorage unless explicitly accepted"). The
concrete risk: **`localStorage` is readable by any JavaScript running on the
console origin, so a successful XSS on the console can exfiltrate both tokens.**
The refresh token is the more serious of the two — it is long-lived (7 days) and
rotating, so a stolen refresh token buys an attacker a renewable session rather
than a 15-minute window.

The baseline permits this storage **only** with a documented, owner-approved,
time-limited risk acceptance recording the compensating controls (spec §12
exception format). This ADR is that record. Moving the refresh token out of
JavaScript reach (an httpOnly cookie) is the correct long-term fix but is a
larger change with its own migration and CSRF surface; it is explicitly out of
scope for the change that accompanies this ADR (issue #59 says "do NOT rip out
localStorage auth in this PR").

## Decision

**Accept, for now, storing the access and refresh tokens in the console's
`localStorage`.** Do not change the storage mechanism in this change. Record the
risk, the mitigations already in place, the compensating controls we commit to,
and the conditions that force us to revisit — and pin the accepted state with a
regression test so the exception cannot drift silently.

## Mitigations already in place (verified)

These are server-side and remain the primary reason the residual risk is
tolerable. Each was confirmed in the codebase while writing this ADR:

- **Short access-token TTL — 15 minutes.** `JWT_ACCESS_EXPIRES_IN` defaults to
  `15m` (`api/src/config/env.ts`). A stolen _access_ token expires quickly.
- **Refresh rotation on use.** `AuthService.refresh()`
  (`api/src/services/auth-service.ts`) verifies the presented refresh token,
  issues a **new** pair, and re-hashes/updates the `user_sessions` row — a
  used refresh token does not remain valid.
- **Refresh tokens stored hashed, never in plaintext, server-side.** Each
  `user_sessions` row holds a bcrypt hash of the refresh token, not the token.
- **Access-token revocation (JTI blacklist).** `logout()` writes the JTI to
  `jwt_blacklist` and to Redis (`bl:{jti}`); `authenticate`
  (`api/src/middlewares/authenticate.ts`) rejects blacklisted JTIs.
- **Session teardown on logout, password change, and password reset.** All
  destroy the user's `user_sessions` rows, invalidating outstanding refresh
  tokens.

## Compensating controls (committed as part of this acceptance)

- **No token logging.** The console does not log the access or refresh token
  (verified: no `console.*` writes the token, and the axios response
  interceptor logs nothing). Any future logging that includes a token is a
  regression and must be rejected in review.
- **No unsanitized HTML rendering — keep the XSS surface small.** Per CLAUDE.md,
  rich text must go through `dompurify`, and `dangerouslySetInnerHTML` is
  banned. Verified: `ui/src/` contains **no** `dangerouslySetInnerHTML`. This
  is the single most important compensating control, because the accepted risk
  is realized _only_ through XSS.
- **Content-Security-Policy on the console host — pending #61.** A restrictive
  CSP materially reduces the chance that an injected script can run and reach
  `localStorage`. Issue #61 (console/widget static hosts missing CSP/COOP/CORP/
  HSTS) is the tracking item; when it lands, the console ships a CSP and this
  acceptance's residual risk drops accordingly.
- **Regression test pins the accepted state.** `ui/src/store/auth.test.ts`
  asserts the exception explicitly (tokens persist under `livechat.auth` in
  `localStorage`, and nothing is written to `sessionStorage`) and points back
  here, so a change to the storage model surfaces in review against this ADR.

## Conditions that force a revisit

Re-open this decision (and prefer the httpOnly-refresh-cookie design below) when
**any** of the following holds:

1. **The review-by date (2027-02-15) passes** without the token storage having
   moved out of JavaScript reach.
2. **CSP (#61) does not ship** on the console host by that date — losing the
   main compensating control makes the residual risk no longer acceptable.
3. **The console begins rendering any untrusted/rich content** (customer
   messages, tenant-authored copy) into the DOM as HTML, enlarging the XSS
   surface.
4. **Refresh-token lifetime is increased** beyond the current 7 days, or refresh
   rotation is weakened.
5. **A real XSS is found** in the console, or a security review/audit downgrades
   this control.

## Consequences

- **Easier:** no auth re-architecture right now; login/refresh/logout/
  password-change flows and their existing integration + e2e tests are
  untouched.
- **Harder / committed to maintain:** the compensating controls above become
  standing obligations — CSP (#61), the `dangerouslySetInnerHTML` ban, and the
  no-token-logging rule are now load-bearing, and the storage regression test
  must be kept honest.
- **Door left open:** the httpOnly-refresh-cookie migration is deferred, not
  cancelled — this ADR will be superseded by it.

## Alternatives considered

- **httpOnly + `SameSite` refresh cookie, access token in memory only
  (preferred long-term).** The refresh token becomes unreadable by page
  JavaScript; the access token lives in a JS variable and is lost on reload
  (re-minted via the refresh cookie). Rejected _for now_ only on scope: it needs
  a new cookie-authenticated `/auth/refresh` path, CSRF defense for that
  endpoint (double-submit or `SameSite=Strict`), and coordinated widget/console
  work. This is the intended successor.
- **BFF / server-side session (token-handler pattern).** A backend-for-frontend
  holds tokens and exposes only an opaque session cookie to the browser.
  Strongest option; rejected as disproportionate to a single-console SPA at this
  stage and a larger operational change.
- **Move tokens to `sessionStorage`.** Evaluated and rejected as **not a real
  improvement against the stated risk**: `sessionStorage` is equally readable by
  page JavaScript, so it does nothing against XSS exfiltration; it only shortens
  persistence to the tab lifetime, which trades away the multi-tab / reload UX
  the current design deliberately keeps. Changing storage here would imply a
  security win that does not exist.
- **Encrypting the tokens in `localStorage`.** Rejected as security theater —
  the key would have to live in the same JavaScript context that XSS already
  controls.

## Links

- GitHub issue #59 (this record's acceptance criterion 3: "asserts the accepted
  exception explicitly")
- GitHub issue #61 — console/widget CSP/COOP/CORP/HSTS (compensating control)
- `ui/src/store/auth.ts`, `ui/src/services/api.ts`, `ui/src/services/socket.ts`
- `api/src/services/auth-service.ts`, `api/src/middlewares/authenticate.ts`
- `docs/security/browser-token-storage.md`
- CLAUDE.md — "dompurify for any rich-text rendering", no
  `dangerouslySetInnerHTML`
- Part of the 10-issue security-baseline program.
