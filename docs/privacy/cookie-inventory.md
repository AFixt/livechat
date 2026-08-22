# Cookie & storage inventory — embedded widget

Every cookie and browser-storage key the AFixt LiveChat widget (and the API it
talks to) sets on a **host client site**. Maintained as the source of truth for
client-facing privacy notices and CMP configuration. Issue #54.

Scope: the customer-facing embeddable widget and its `/api/v1/visitor/*`
endpoints. The support/admin **console** is a separate first-party app on
AFixt's own domain; its authentication cookies are never set on client sites and
are out of scope here.

## Cookies

| Name                   | Purpose                                                                                                                                                          | Type                            | Party       | Duration | HttpOnly                                    | Secure                                                  | SameSite | Set by                                                       | Data category                                                                                                                        |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------- | ----------- | -------- | ------------------------------------------- | ------------------------------------------------------- | -------- | ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------ |
| `livechat_visitor`     | Signed identifier for the visitor's chat session; correlates the browser to a server-side `visitor_sessions` row so a chat survives page navigation and reloads. | Functional (strictly necessary) | First-party | 30 days  | Yes                                         | Yes in production (`secure` when `NODE_ENV=production`) | `Lax`    | API — `res.cookie` in `api/src/routes/visitor.ts`            | Pseudonymous session identifier. Carries no name/email; the value is an HMAC-signed random session id, not personal data on its own. |
| `afixt_livechat_muted` | Remembers whether the visitor muted the widget's audible alert, so the preference survives navigation within the session.                                        | Functional (preference)         | First-party | 30 days  | No (set by widget JS so the UI can read it) | No                                                      | `Lax`    | Widget — `document.cookie` in `widget/src/services/audio.ts` | UI preference only (`0`/`1`). No personal data.                                                                                      |

Notes:

- Both cookies are **first-party** — they are written for the host site's own
  origin, not a shared AFixt tracking domain, and are not readable across sites.
- `livechat_visitor` is `HttpOnly` so page scripts (and any XSS) cannot read the
  session identifier; `afixt_livechat_muted` is intentionally script-readable
  because the widget UI toggles it.
- Neither cookie is used for advertising, cross-site tracking, or profiling.

## Local / session storage

**None.** The widget uses no `localStorage`, `sessionStorage`, or `IndexedDB`.
All chat UI state is held in memory (a Preact reducer); the only persisted
client state is the two cookies above. This is asserted by
`widget/src/no-third-party.test.ts` (source scan) and verifiable by grepping
`widget/src` for storage APIs.

## Vendor disclosure

The widget loads **no third-party trackers, analytics SDKs, web fonts, or CDN
assets**. Verified:

- No absolute external origins appear anywhere in `widget/src` — enforced by the
  `widget/src/no-third-party.test.ts` unit test, which fails the build if any
  `http(s)://` origin (or a known tracker/analytics/font host) is referenced.
- The alert chime is an inlined `data:` URI, not a fetched asset
  (`widget/src/services/audio.ts`).
- The REST client and Socket.IO client talk only to the **same origin** as the
  page host via relative paths (`/api/v1`, `/api/socket.io`) — see
  `widget/src/services/api.ts` and `widget/src/services/socket.ts`.
- Preact is bundled into the widget; there is no runtime third-party script tag.

Consequently the **only** cookies the widget introduces are the two first-party
functional/preference cookies listed above. There are no analytics or
advertising cookies to disclose.

### Vendor declaration

As the embedded vendor, AFixt declares of the data handled through these cookies
and the widget:

- **No sale** of personal data.
- **No sharing** with third parties for their own or cross-context behavioral
  advertising purposes.
- **No targeted / cross-context advertising.**
- **No use for AFixt's own purposes beyond delivering the live-chat service**
  (operating the chat, correlating a session to its chat history, and honoring
  the mute preference). Data minimization and retention are governed by the
  visitor data-retention ADR (ADR-0011, landing with issue `#57`).

## CMP / consent

Because both cookies are strictly-necessary/functional, most consent regimes
permit them without prior opt-in. Host sites that nonetheless want to gate the
widget (including its presence/telemetry capture) behind their Consent
Management Platform can use the widget's consent hook — see
[`cmp-integration.md`](./cmp-integration.md).
