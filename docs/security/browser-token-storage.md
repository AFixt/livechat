# Browser token storage (support console)

Status: **accepted risk, time-limited** — see
[ADR-0013](../adr/0013-jwt-localstorage-risk-acceptance.md).

## What we do today

The support console (`ui/`) keeps the JWT **access token** and **refresh token**
in `localStorage`, under the key `livechat.auth`, via Zustand's `persist`
middleware (`ui/src/store/auth.ts`). This survives page reloads so an operator
is not logged out on refresh.

## Why this is a risk

`localStorage` is readable by any JavaScript running on the console origin, so a
successful cross-site-scripting (XSS) attack could exfiltrate both tokens. The
refresh token is the bigger concern because it is long-lived (7 days) and
renewable.

## Why it is accepted for now

Server-side mitigations blunt the impact, and compensating controls keep the XSS
surface small:

- 15-minute access-token TTL; refresh rotation on use; refresh tokens stored
  only as bcrypt hashes in `user_sessions`; JTI blacklist on logout; sessions
  destroyed on logout / password change / password reset.
- No token is logged; no `dangerouslySetInnerHTML` in the console; rich text
  must go through `dompurify` (CLAUDE.md).
- A Content-Security-Policy on the console host is tracked in **#61** and is the
  main compensating control still outstanding.

The full rationale, the alternatives (httpOnly refresh cookie; BFF), and the
conditions that force us to revisit are in ADR-0013.

## How this is enforced in tests

`ui/src/store/auth.test.ts` asserts the accepted exception explicitly: the
tokens persist to `localStorage` under `livechat.auth` and nothing is written to
`sessionStorage`. If the storage model changes, that test changes with it —
which is the prompt to revisit ADR-0013 rather than let the exception drift
silently.

## When we will change it

When the review-by date passes, when CSP (#61) fails to ship, when the console
starts rendering untrusted HTML, or when refresh-token lifetime grows — see
ADR-0013 "Conditions that force a revisit". The intended successor is an
httpOnly, `SameSite` refresh cookie with the access token held in memory.
