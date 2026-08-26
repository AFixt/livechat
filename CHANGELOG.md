# Changelog

All notable changes to this project are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Architecture decisions referenced below live in [`docs/adr/`](docs/adr/).

## [0.3.1] - 2026-08-26

### Fixed

- **A slow link no longer blocks pushes for two days.** The `links` step of
  `check:all` failed on a `web.archive.org` URL in `README.md` that was
  healthy — the host answered in 9.8s, then timed out past 60s, then answered
  in 29.8s, all inside a minute. Worse than the flake was what followed: lychee
  writes a timeout into `.lycheecache` with an **empty** status field, and
  `--cache-exclude-status` only accepts codes between 100 and 999, so a timeout
  cannot be excluded from the cache by configuration at all. With
  `max_cache_age = "2d"` every later run then failed instantly with
  `Error (cached)` — reported as a hard error rather than the timeout it was —
  until the row was deleted by hand. `npm run links` now runs through
  `scripts/link-check.sh`, which drops undecided (status-less) rows from the
  cache before and after each run, so a transient failure costs one extra
  request instead of a blocked gate; 5xx responses are excluded natively via
  `cache_exclude_status`, which lychee *can* express. `web.archive.org` joins
  `output.jsbin.com` in the exclusion list, on the same reasoning: a snapshot is
  immutable by design, so checking one buys no signal. Raising `timeout` was
  measured and rejected — no value makes that host reliable. ([#155])

- **The pre-push gate no longer fails on a Node newer than the pinned one.**
  Node 22.4+ ships its own Web Storage globals, and its `localStorage` is inert
  unless the process was started with `--localstorage-file`. Vitest's jsdom
  environment leaves an already-present global alone, so on Node 26 that inert
  one shadowed jsdom's and `window.localStorage` came out `undefined` —
  `ui/src/store/auth.test.ts` died in `beforeEach` before a single assertion
  ran. Because `.husky/pre-push` runs `check:all` → `test:ci` → `test:ui`, that
  blocked **every** push regardless of what it changed, and `--no-verify` was
  the only way through, which is precisely how a gate stops catching the
  failures it exists for. The ui and widget test workers now start with
  `--no-experimental-webstorage`, handing the name back to jsdom's working
  implementation, so the suites keep real `Storage` semantics instead of a
  hand-rolled stub. The flag is passed only when Node reports it as accepted
  (`process.allowedNodeEnvironmentFlags`) rather than inferred from the presence
  of the globals: an unrecognized option kills every worker with `Worker exited
  unexpectedly`, naming neither the flag nor storage, so a runtime that predates
  the option — or a future one that drops it in favour of `--webstorage` — is
  left alone and fails in the named guard instead. Node 22 remains the supported
  runtime. ([#153])

## [0.3.0] - 2026-08-22

### Security

- **The ui and widget images are scanned for vulnerabilities for the first
  time.** `trivy image` builds api → ui → widget, and the ui build had never
  succeeded: it installs workspace devDependencies (the Vite build needs
  `vite`/`typescript`), which include private `@afixt/*` packages, and the job
  had no registry auth — so `npm ci` 404'd. Worse, `scripts/trivy-image.sh`
  runs under `set -euo pipefail` with an unguarded `docker build`, so that one
  failure aborted the script and denied **widget** a scan too. The lockfile
  carries seven private `@afixt/*` packages, several transitive
  (`@afixt/a11y-assert` is a direct ui devDependency and pulls
  `@afixt/test-utils`), so keeping them out of the build was not an option —
  the build genuinely needs credentials. The npmrc is now mounted into the ui
  and widget builds as a **BuildKit secret**, never a build arg, so the token
  cannot persist in an image layer or in `docker history`; `required=false`
  keeps the builds usable without one. The script no longer lets one
  unbuildable image suppress the others: each failure is recorded, the run
  continues, and the images that went unscanned are named explicitly at the end
  so a red run can never be mistaken for a clean one. ([#130])

### Security
- **Container vulnerability scanning runs for the first time, and all three
  images pass.** Getting `trivy image` past the private-registry 404 exposed two
  further problems it had been hiding. The **ui image build had never succeeded
  even with credentials**: `ui/tsconfig.json` includes `playwright.config.ts`,
  which since #127 imports the repo-root `e2e/support/generated-spec-config.js`
  that `ui/Dockerfile` never copied, so `tsc -b` failed on TS2307. Latent on
  `develop` since #127 and invisible because nothing ever got that far. The
  build stage now copies `e2e/`; the runtime stage still takes only `ui/dist`,
  so nothing test-related ships. And once ui and widget scanned, the
  **CRITICAL gate immediately failed on real findings** — `CVE-2026-31789`
  (OpenSSL heap overflow, `libcrypto3`/`libssl3` 3.3.3-r0, fixed in 3.3.7-r0)
  plus 33 HIGHs, all from `nginx:1.27-alpine` lagging its own Alpine base. Both
  runtime stages now `apk upgrade --no-cache`, which takes the fix already
  published in the repo the base points at rather than waiting for the nginx
  image to be rebuilt. Result: api, ui and widget all scan clean at HIGH and
  CRITICAL.
  This also demonstrates the #60 policy with real findings rather than seeded
  ones — 2 CRITICALs failed the gate while 33 HIGHs did not, which is exactly
  the documented behaviour. ([#130])
### Security
- **Jurisdiction is now resolved server-side from a trusted edge header, not the
  request body.** The consent gate decided opt-in vs opt-out from a `country` /
  `region` the client sent, but the widget runs on the client's own site — so an
  embedding page could have declared `US` for an EU visitor and turned an opt-in
  jurisdiction into an opt-out one. Those fields are gone from
  `POST /visitor/session` and from the `/privacy/*` bodies and query; the value
  now comes only from the header named by `GEO_COUNTRY_HEADER` /
  `GEO_REGION_HEADER`, which the CDN or load balancer injects and must strip
  from client input. GPC stays client-readable on purpose — a signal that can
  only ever *deny* tracking is safe to accept, one that could *grant* it is not.
  With no header configured every visitor resolves to Unknown Location Mode,
  which denies presence: the fail-safe, and the honest description of what the
  gate could already determine, since the widget never sent a country. ([#53])

- **The api image no longer ships a package manager, clearing a CRITICAL CVE.**
  `trivy image` was failing the gate on `CVE-2026-59873` (node-tar DoS via a
  crafted gzip bomb) plus seven HIGHs in `brace-expansion`, `ip-address`,
  `picomatch` and `sigstore`. None of them were ours — `tar` does not appear in
  `package-lock.json` at all; every one came from the dependency tree vendored
  inside the npm that ships in `node:22-alpine`, so no dependency bump in this
  repo could have fixed them and Dependabot would never have seen them. npm,
  npx, corepack and yarn are now removed from the runtime stage, and the things
  that actually ran through them are invoked from `node_modules/.bin` directly:
  `CMD` execs `tsx` instead of `npm run start` (one fewer process in the
  container), and the migrate/seed jobs in `.do/app.yaml` and the migrate
  service in `docker-compose.prod.yml` call `sequelize-cli` / `tsx` by path.
  `WORKDIR` is now `/app/api` so cwd-relative config still resolves as it did
  under `npm --workspace` — notably `api/.sequelizerc`. Deleting rather than
  upgrading npm removes the whole class of finding instead of resetting its
  clock. Verified: image builds, container reaches `healthy` and serves
  `/api/v1/health`, `sequelize-cli db:migrate` applies all 13 tables from the
  image, and `trivy image --severity CRITICAL --exit-code 1` now exits 0 with no
  HIGH or CRITICAL findings at all. ([#132])

### Added
- **Data-subject access and erasure are actually implemented.**
  `POST /api/v1/privacy/data-request` returned a `requestId` and audited the
  request, but exported nothing and erased nothing — the endpoint answered
  "queued" to a request no queue would ever pick up. It now fulfils
  synchronously and returns `200` (not `202` — nothing is left outstanding by
  the time it returns). An access request exports the subject's visitor
  sessions, chats, messages and consent records; an erasure request disposes of
  them following the deployment's configured retention strategy, so on-demand
  and scheduled disposal behave identically (#57): `anonymize` clears every PII
  column but keeps the row so transcripts stay referentially intact, `delete`
  hard-deletes the session and the cascade takes its chats and messages. The
  PII column list moved to `services/visitor-pii.ts` and is shared by both
  paths, so a new personal-data column cannot be handled by the retention sweep
  but missed by a data-subject request. Consent records for the subject are
  erased too, while the `audit_logs` entry survives — that is what records the
  request happened without retaining what it was about. Synchronous because the
  subject is one visitor's worth of rows: a queue plus a status endpoint would
  add a window in which the request is accepted but not honoured, without the
  answer arriving sooner. ([#121])
- **Staff can end a visitor's session from the console.** #79 (PR #94) delivered
  server-side expiry and a visitor-initiated "forget me", but deferred the
  issue's "at minimum, staff can end a session" clause, so an operator had no
  way to revoke a specific visitor. `DELETE /api/v1/visitor-sessions/:id` now
  does it, staff-authenticated and tenant-scoped — a tenanted operator is
  confined to their own tenant, an untenanted AFixt operator spans all of them
  (#19). It reuses #94's rejection path rather than adding a new one: the row is
  hard-deleted, and because both the HTTP `/visitor/*` routes and the `/visitor`
  socket handshake resolve through `findByCookie`, a missing row already 401s.
  Any live socket is disconnected through the adapter so it reaches other nodes
  (#73), presence is cleared so the console list drops the visitor, and the
  action is audited. Deliberately skips the expiry gate — an already-expired
  session must stay revocable, since the row and its PII outlive the window in
  which the cookie works. In the console each visitor row now carries two
  **sibling** controls (MUI `ListItem` + `secondaryAction`) rather than a button
  nested inside a button, which would be invalid and unreachable by keyboard;
  each is named for the visitor it acts on, and the outcome is announced in a
  named live region, because a row silently vanishing is not perceivable to
  someone focused on it. ([#123])
- **The OpenAPI document now describes the whole API, so the security tooling
  built in #62 has something to scan.** Only `GET /health` registered a path, so
  the Schemathesis fuzzer and the ZAP API scan — wired, correct, and green —
  were exercising exactly one endpoint. The document now carries **40 operations
  across 33 paths** (auth, visitor, chats, tenants, users, invitations, privacy,
  widget, health), each with its Zod request/response schemas, its `security`
  requirement, and the failure codes it can actually produce, so a scanner can
  tell a documented rejection from an undocumented 500. Registration lives in
  `api/src/routes/openapi/`, one module per router, side-effect-imported by the
  route module it describes — the same top-level-registration rule
  `docs/security/api-testing.md` sets out, and small enough to keep every route
  file under the 300-line limit. Two tests stop it drifting: a new coverage test
  walks every mounted router and fails on a route with no path, a path with no
  route, or a router missing from the mount table (with a floor on the number of
  operations compared, so an empty walk cannot pass vacuously), and the existing
  spec-security tripwire from #62 now covers the full surface. That tripwire
  earned its keep immediately — its public-operations allowlist named
  `post /auth/refresh` and `post /auth/verify-email`, neither of which exists;
  the real routes are `post /auth/refresh-token` and
  `get /auth/verify-email/{token}`, and it caught both the moment they were
  registered. ([#119])
### Fixed
- **Availability live-push now reaches visitors on every node, not just the one
  the agent happens to be connected to.** `broadcastGlobalStaffAvailability`
  (#101) bounded its fan-out to tenants with a connected visitor by reading the
  `/visitor` namespace's `tenant:{id}` room membership. `adapter.rooms` only
  ever describes the **local** node, so once #73's Redis adapter spread visitors
  across processes, a tenant whose visitors were all on other nodes was never
  enumerated and never received the push — it silently fell back to picking the
  change up on the next `/widget/config` fetch. The tenant set now comes from
  Redis-backed presence instead: `markVisitorPresent` maintains a
  `presence:visitor-tenants` index, and `presence.tenantsWithVisitors()` reads
  it, pruning members whose presence hash has expired so the set cannot
  accumulate tenants nobody is watching and widen the fan-out it exists to
  bound. Both narrowings are kept, so a toggle that changes nothing observable
  still emits nothing. Proved with two presence services on separate Redis
  connections standing in for two nodes — and the same test demonstrates the old
  source failing, with a room joined on one Socket.IO server invisible to the
  other. ([#125])
### Fixed
- **Starting a chat no longer depends on winning a race against the widget's own
  startup.** The widget renders its start-chat form immediately, but a visitor
  session only exists after three sequential round-trips
  (`/widget/config` -> `/visitor/chats/current` -> `/visitor/session`). Nothing
  gated the form on that, so a visitor who submitted first sent
  `POST /visitor/chats` with no cookie, got a `401`, and landed on a bare
  "Visitor session required" alert. Reachable on a slow or high-latency link, for
  a returning visitor whose cookie had expired, and whenever the API was briefly
  slow — it reproduced deterministically with the session response delayed, and
  failed outright under CI load. The bootstrap is now a single shared promise
  (`bootstrapVisitorSession`) that both the widget's startup and the submit path
  await, so an early submit waits for the *same* session instead of racing it or
  minting a second one — a returning visitor's resumable chat is never orphaned.
  If the write is still refused for want of a session (expired or revoked
  server-side, #79), the widget mints a fresh session and retries exactly once; a
  second refusal is a real failure and surfaces. `apiFetch` now throws a typed
  `ApiRequestError` carrying the status, so that decision is made on the status
  rather than by matching a message string. While the session is being
  established the form is `aria-busy` and the wait is announced, so the submit
  button is never a silently dead control (requirements.md §3). The visitor's
  typed name and message were already preserved — the form keeps its own state
  and stays mounted — and pressing "Start chat" again is the retry path.
  ([#129])
- **`zap-pr` is a working gate again instead of a permanently-red one.** It had
  failed on every pull request and on `develop`, while the scan itself found
  nothing at FAIL level (`FAIL-NEW: 0`, `WARN-NEW: 9`). Two causes. First, it
  served `ui/dist` with `npx http-server` — but the console ships on nginx, and
  `ui/nginx.conf` sets CSP, `X-Frame-Options`, `nosniff`, `Permissions-Policy`
  and `Cache-Control` explicitly, so five of the nine findings existed only
  because the scan target was a bare static file server. It now serves the
  bundle through the shipped `ui/nginx.conf` on the same `nginx:1.27-alpine`
  base the `ui/Dockerfile` runtime stage uses (plain nginx rather than the image
  build, which needs private-registry credentials a header scan has no reason to
  require — #130). Second, `fail_action: true` alone fails on *any* alert,
  collapsing WARN into FAIL and defeating the three-tier model `rules.tsv`
  documents; `-I` is now passed so a WARN warns and a FAIL still fails. The cost
  of the old behaviour was not the red check but the blindness: with the job
  always failing, nobody could tell "the usual nine" from "ten, and the new one
  is real". Also tuned with reasons: `90005` (Sec-Fetch-Dest) is a _request_
  header no server can set, now IGNORE; `10049` (cacheable static assets) is the
  intent, now WARN.
  `-I` alone would have replaced a permanently-red gate with a permanently-green
  one — `zap-baseline` treats every rule as WARN unless the rules file names it
  FAIL, and nothing was named. `rules.tsv` now has an explicit FAIL tier
  (clickjacking, nosniff, CSP, server-version leak, cross-domain script), and
  the gate was demonstrated end to end against the real nginx config rather than
  assumed: shipped config exits 0, removing the console's clickjacking
  protection exits 1 on rule 10020, restoring it exits 0. Removing only
  `X-Frame-Options` correctly does _not_ fail, because CSP `frame-ancestors
  'none'` still protects the page. ([#131])

### Security
- **Both nginx hosts stopped advertising their exact version.** `Server:
  nginx/1.27.5` narrows a published nginx CVE into a targeted request.
  `server_tokens off` in `ui/nginx.conf` and `widget/nginx.conf` leaves a bare
  `Server: nginx`. Found by the ZAP baseline (rule 10036) on its first run
  against the shipped config — the old `http-server` target could not have
  surfaced it — and the rule is now FAIL-tier so it cannot come back quietly.
  ([#131])
- **The console is now cross-origin isolated.** ZAP rule 90004 was carried as a
  WARN reading "COEP intentionally unset so the widget stays cross-origin
  embeddable" — true of the widget, and never examined for the console. Split:
  `ui/nginx.conf` sets `Cross-Origin-Embedder-Policy: require-corp`, which costs
  nothing there because its CSP is `default-src 'self'` and it loads no
  cross-origin subresources; `widget/nginx.conf` deliberately does not, because
  the widget is loaded *into* customer pages where COEP would govern the host
  page rather than protect the widget and `Cross-Origin-Resource-Policy:
  cross-origin` is the header that matters. Verified in a browser against the
  shipped config — `window.crossOriginIsolated === true`, the app mounts, no
  console errors. `scripts/check-headers.mjs` now requires COEP on the console
  and forbids it on the widget, so neither half can be silently undone.
  Recorded in ADR-0012, which also picks up the stale `ADR-0011` references
  in `rules.tsv` and `docs/security/zap.md`. ([#131])
### Fixed
- **The widget can work on a third-party site at all — the visitor session now
  survives cross-site embedding.** The `livechat_visitor` cookie was
  `SameSite=Lax`, so no browser sent it on the cross-site subresource requests
  an embedded widget makes: every call after the bootstrap was unauthenticated
  and the Socket.IO handshake carried no credential. This is the fix reviewed
  and approved in PR #93, which never reached `develop` — it merged into
  `fix/77-csrf` twelve minutes after that branch had itself merged, so the
  branch was abandoned with the work on it. Re-applied here on top of the
  consent work (ADR-0019) that has since moved the cookie options into a shared
  helper. In production the cookie is now `SameSite=None; Secure; Partitioned`
  (CHIPS); local dev stays `Lax`, since `None` requires `Secure` and a `Secure`
  cookie is dropped on localhost HTTP. Because Safari (ITP) and Firefox (TCP)
  block third-party cookies outright, the cookie alone is not enough: the
  bootstrap endpoints also return the signed session as `sessionToken`, the
  widget persists it in first-party storage and resends it as
  `X-Visitor-Session` (allow-listed in CORS, passed as `auth.cookie` on the
  socket handshake), and the API resolves the session from that header first
  and the cookie second through one shared helper. The header path is still
  CSRF-gated, and cannot be set cross-site without a preflight the per-tenant
  CORS layer (#74) already gates. Also fixed on the way through: `clearCookie`
  on "forget me" now repeats the cookie's attributes, without which a
  `SameSite=None; Secure; Partitioned` cookie is never cleared (#79), and the
  privacy router resolves its subject through the same helper so a
  cookie-blocked visitor can still read, record and withdraw consent (#56). The
  security-regression suite pinned `SameSite=Lax` in production and now pins
  `SameSite=None; Secure; Partitioned`. See [ADR-0021]. ([#75])
- **The local quality gate can be run again.** `npm run check:all` — the
  pre-push gate — failed for reasons unrelated to any code under review, so
  changes were going out under `--no-verify` with CI as the only check. Two
  causes, both silent. Every *directory* entry in `.markdownlint-cli2.jsonc`
  used a bare trailing slash (`dist/`, `**/test-results/`); markdownlint-cli2
  matches those globs against *file* paths, so they matched nothing and ignored
  nothing — including the entry whose own comment said it existed so a failing
  e2e run would not block the push. And nothing excluded `.claude/`, where
  Claude Code keeps agent worktrees: full checkouts of this repo living inside
  it, which made ESLint report every finding once per worktree (379 errors, all
  from copies) and `jscpd` measure the tree against six near-copies of itself
  (78.55% duplication against a 1% threshold). `jscpd`'s own `"gitignore": true`
  did not cover it either, so the exclusion is explicit. `lychee/out.md`, which
  `lychee-action` writes into the workspace before the gate runs, is excluded
  for the same reason as the Playwright contexts. `shared/tests/gate-ignores.test.ts`
  now pins all of it: a non-compliant file is dropped into each ignored location
  and the gate must stay quiet, while an un-ignored one must still be reported —
  so the ignores cannot silently go inert again.


- **Chat is no longer silently dead after a socket reconnect** ([#69]). Two
  compounding faults: (1) `getStaffSocket()`/`getVisitorSocket()` called
  `.disconnect()` on a socket whose `.connected` was false — which permanently
  kills socket.io's own reconnect loop and orphans every listener — so the
  clients returned a dead socket instead of the reconnecting one; and (2) even
  once reconnected, `chat:{id}` room membership does not survive a new socket,
  so messages stopped arriving. Now: the getters return the existing instance
  (letting socket.io reconnect), both clients re-emit `chat:join` on every
  (re)connect (a new `/staff` `chat:join` handler re-enters the room without
  changing assignment), the widget backfills the transcript via
  `messages_synced` (de-duplicating optimistic sends), and a reconnect is
  surfaced programmatically, visibly, and audibly (widget banner + live-region
  announcement; console live-region announcement). ([#69])
### Security

- **Global Privacy Control is now detected and honored.** `navigator.globalPrivacyControl`
  was never read and no universal opt-out signal was honored anywhere. Now: ([#55])
  - The widget reads `navigator.globalPrivacyControl` and sends it to
    `POST /visitor/session`; the API also honors the `Sec-GPC: 1` request header.
    Either source counts.
  - A detected signal feeds the policy engine as a universal opt-out: it
    suppresses presence/analytics in every jurisdiction, so **no tracked session
    is created** — and it stops ambient tracking for an already-tracked returning
    visitor too, not just a first-time one.
  - The signal is recorded as a `gpc`-sourced consent record (`legal_basis:
    opt_out`) and audited as `privacy.gpc_detected` + `privacy.gpc_applied`.
  - Tests: GPC via header and via the widget signal both yield no tracking plus
    an audited opt-out record; the effective-state GPC true/false paths are unit
    tested in `consent-policy.test.ts`.
- **Visitor presence tracking is now gated behind a consent decision.**
  Previously the widget created a `visitor_sessions` row — capturing IP, user
  agent, current URL, and referrer — for every visitor on page load, in every
  jurisdiction, with no consent gate (behavioral tracking of visitors who never
  engaged). Page load now runs the consent gate first: ([#53])
  - In opt-in (EU/EEA/UK) and Unknown-location modes, **no tracked session is
    created and no IP/geo/URL is captured** until the visitor consents or
    actively starts a chat. `POST /visitor/session` returns `sessionId: null`
    and the widget keeps the presence socket closed.
  - In US opt-out modes, presence tracking proceeds by default unless the
    visitor has opted out (or GPC is present — see #55).
  - **Functional use is never blocked.** The widget still renders and a visitor
    can always start a chat; opening a chat is strictly necessary and lazily
    creates the session at that point. New widget use case
    `functional-without-consent.uc.yaml` covers this.

### Added

- **Typing indicators are live end-to-end** (part of [#80]). The server already
  relayed `chat:typing`, but neither client sent or showed it. The widget and
  console now emit a debounced typing signal while composing (stopping on idle,
  blur, or send) and render the other party's typing in an `aria-live` status
  region — "Support is typing…" in the widget, "{name} is typing…" in the
  console — so the cue is programmatic, visible, and announced (§3).
- **The "email me the transcript" affordance now works** (part of [#80]). It was
  a no-op (`onEmailTranscript={() => Promise.resolve()}`). New endpoint
  `POST /api/v1/visitor/chats/:id/transcript` mails the conversation to a
  visitor-supplied address via the existing email service, scoped so a visitor
  can only transcribe their own chat.
- **Socket.IO now works across multiple API instances.** The real-time layer is
  wired to a Redis adapter (`@socket.io/redis-adapter`, `api/src/io/adapter.ts`)
  so rooms and broadcasts span every process. Previously `.do/app.yaml` deployed
  `instance_count: 2` with no adapter, so rooms were per-process and roughly half
  of all messages between a visitor and an agent on different instances were
  silently lost. The adapter uses dedicated pub/sub Redis connections (a
  subscriber connection can't serve other commands), its readiness is surfaced
  by `GET /api/v1/health` as `data.socketAdapter`, and its connections are closed
  on graceful shutdown. `docs/deploy.md` documents that horizontal scaling
  depends on it. ([#73])

### Security

- **Visitor data retention & minimization.** IP, geo, URL, referrer and
  user-agent were stored on `visitor_sessions` indefinitely. Now:
  - **Minimized at capture** — `api/src/utils/pii-minimize.ts` truncates the IP
    (last IPv4 octet / last 80 IPv6 bits zeroed) and coarsens geo to
    country-level before it is persisted, applied in `visitor-session-service`.
  - **Retention-bound** — a configurable window (`VISITOR_DATA_RETENTION_DAYS`,
    default 90) and a retention job (`data-retention-service` +
    `scripts/purge-expired-visitor-data.ts`) anonymize (default) or hard-delete
    expired sessions. Idempotent; logs counts.
  - Geolocation record model, lawful basis and rationale documented in
    [ADR-0020][adr-0020] and `docs/privacy/data-retention.md`. ([#57])

### Removed

- **Chat attachments deferred until the feature is built (part of #80).** The
  `chat_attachments` table, model, and associations existed and `S3_ACCESS_KEY`
  / `S3_SECRET_KEY` / `S3_BUCKET` were **required at boot**, but there was no
  upload/download route, no UI, and no `@aws-sdk` usage — every deployment had
  to supply real S3 credentials for a feature that did not exist. The table
  (via a reversible migration), model, and associations are removed, and the
  `S3_*` env vars are now optional. Typing indicators and the email-transcript
  affordance (the other two parts of #80) are handled separately. See
  [ADR-0017]. ([#80])
### Security

- **The widget mute-preference cookie now carries `Secure`** ([#58]). The
  `afixt_livechat_muted` cookie was written with `SameSite=Lax` but no
  `Secure`, so on the third-party HTTPS pages the widget embeds into it could
  travel over a downgraded/plaintext connection. It is now `Secure` on any
  HTTPS origin (omitted only on a plaintext-HTTP origin, i.e. local dev, where
  the browser would otherwise drop it).
- **Documented risk acceptance for JWT tokens in console `localStorage`**
  ([#59], part of the security-baseline program). The support console persists
  the access + refresh token to `localStorage`, which is XSS-exfiltratable. Per
  the baseline's exception rules this is now an explicit, owner-approved,
  time-limited acceptance: [ADR-0013] records the risk, the server-side
  mitigations already in place (15-minute access TTL, refresh rotation, bcrypt-
  hashed refresh storage, JTI blacklist, session teardown), the compensating
  controls (no token logging, no `dangerouslySetInnerHTML`, CSP pending #61),
  the rejected alternatives (httpOnly refresh cookie; BFF; `sessionStorage` —
  evaluated and found to be no real improvement), and the conditions that force
  a revisit. A companion note lives at `docs/security/browser-token-storage.md`,
  and `ui/src/store/auth.test.ts` pins the accepted exception so it cannot drift
  silently. No storage change — localStorage auth is intentionally left in
  place per the issue.
- **Swagger UI and the OpenAPI document are no longer served in production.**
  `/api/docs` (and the raw spec at `/api/docs.json`) published the entire route
  and schema inventory — including every admin surface — unauthenticated. Both
  are now mounted only when `NODE_ENV !== 'production'` and return `404` in
  production; developers read the spec from a local/staging run
  (`docs/deploy.md`). ([#78])
- **Security headers on the static-hosted console and widget.** Both nginx hosts
  send a Content-Security-Policy (`default-src 'self'`, strict `script-src`, no
  `'unsafe-eval'`; `style-src 'unsafe-inline'` only, for MUI/emotion), COOP
  `same-origin`, and HSTS (2 years, `includeSubDomains; preload`). The console is
  locked down (CORP `same-origin`, `X-Frame-Options: DENY` + `frame-ancestors
  'none'`); the widget stays embeddable (CORP `cross-origin`, `frame-ancestors
  *`, no `X-Frame-Options`). A new `security:headers` gate
  (`scripts/check-headers.mjs`) config-lints both `nginx.conf` files and runs in
  `check:all`. See ADR-0012. ([#61])
- **TLS/HTTPS verification harness for deployed environments** ([#63]).
  `scripts/check-tls.sh` (`npm run security:tls`) verifies a deployed target's
  transport security via `testssl.sh` (fails on weak ciphers, an invalid chain,
  or a still-offered TLS 1.0/1.1), an HTTP→HTTPS redirect, HSTS, and
  `Secure`/`HttpOnly`/`SameSite` on every `Set-Cookie`. No-op without
  `TLS_TARGET_URL`. Documented in `docs/security/tls-verification.md`.
- **Security-baseline governance** ([#65]) — a governance layer over the
  scanners (ADR-0011). `security/thresholds.yaml` centralizes what each gate
  blocks vs warns on; `security/exceptions.yaml` catalogues every accepted
  suppression with owner, reason, added date, and expiry;
  `scripts/check-exceptions.sh` (`npm run security:exceptions`) fails on expired
  exceptions and warns within 30 days; `scripts/security-report.sh` emits
  machine-readable scanner output into a gitignored `security-reports/`.
  Indexed in `docs/security/README.md`.
- **Container, Dockerfile, and IaC scanning** ([#60]) — Hadolint (Dockerfile
  lint), Trivy `config` (Dockerfile misconfig), Trivy `image` (built api/ui/
  widget image vulnerabilities), Checkov (Dockerfile IaC), and KICS
  (`docker-compose.yml` + `docker-compose.prod.yml` misconfig — the tool that
  actually scans compose, which Trivy and Checkov do not). Each has a
  `scripts/*.sh` wrapper and a `security:*` npm script; all but the image build
  are in the aggregate `security` script, and a PR-time
  `.github/workflows/container-iac-scan.yml` safety net builds the images and
  runs every scan. Gate policy (ADR-0016, `security/thresholds.yaml`): image
  vulnerabilities fail on CRITICAL and warn on HIGH (per #60); IaC/Dockerfile
  misconfigurations fail on HIGH+CRITICAL (documented deviation — misconfigs are
  directly fixable and the IaC tools emit no CRITICALs). `.do/app.yaml` is a
  DigitalOcean spec no scanner structurally covers; it is documented as such
  rather than scanned for show. Accepted findings carry expiry/revisit dates in
  `.hadolint.yaml`, `.trivyignore` (`exp:`), and `.checkov.yaml` and are
  catalogued with owners in `security/exceptions.yaml`; a `HEALTHCHECK` was added
  to all three Dockerfiles. (ADR-0016)
- Two-tier secret scanning ([#82]). The verified/blocking trufflehog gate is
  unchanged; a new suspected (unverified/unknown) tier reports without blocking,
  via `scripts/secret-scan.sh` + `security:secrets:suspected`. A
  `.secrets.baseline` (detect-secrets) records known false positives so the
  suspected tier is actionable, checked by `scripts/detect-secrets.sh` +
  `security:secrets:baseline`; `.trufflehog-exclude.txt` is the trufflehog-native
  path allow-list. A `.pre-commit-config.yaml` wires the detect-secrets baseline
  hook (husky stays the enforced gate); the husky pre-commit now runs both tiers
  on staged files. PR-time `.github/workflows/secret-scan.yml` surfaces the
  suspected tier without blocking. The two tiers are recorded in
  `security/thresholds.yaml`. (See ADR `0015-secret-scanning-tiers`, [#82].)
- **`POST /widget/csp-report` is no longer an unvalidated public log sink.** The
  unauthenticated endpoint previously logged whatever was posted — a
  log-injection and unbounded-log DoS vector. It now validates the body against
  a Zod schema (both the classic `application/csp-report` object form and the
  Reporting-API `report-to` array), rejects anything that doesn't match with a
  400, caps the body at 8 KB with its own parser (413 over that, overriding the
  global 1 MB limit), rate-limits per IP (60/min), and logs only a bounded,
  whitelisted set of fields — never the raw body, the original policy, or the
  violation sample. Also adds an owned, commented OWASP ZAP baseline rule set
  (`.github/zap/rules.tsv`) and `docs/security/zap.md`. ([#84])
- **Socket.IO chat handlers now enforce tenant/visitor ownership.** Every
  `/staff` and `/visitor` event trusted a client-supplied `chatId` and acted on
  it with no tenant check, so any authenticated staff user could read, reply to,
  take over, or end **any** tenant's chat by id, and any visitor could do the
  same to another visitor's chat. Ownership is now enforced inside
  `chat-service` (a `ChatCaller` scope on `getById`/`sendMessage`/`endChat`/
  `assign`), so the HTTP and socket paths share one control and cannot diverge.
  The `/staff` handshake now runs the full HTTP auth path (JTI blacklist, active
  status, tenant expiry) and rejects non-staff roles, so a revoked or
  deactivated token no longer keeps a live socket. Rejections are returned to
  the caller as a `chat:error` event instead of being silently swallowed, and a
  custom Semgrep rule (`.semgrep/rules.yml`) keeps chat lookups behind the
  scoped service. ([#72])
- **Visitor sessions now expire and can be revoked.** The session cookie was a
  30-day, non-revocable credential: `findByCookie` matched on the hash alone,
  with no absolute/idle expiry and no server-side bound beyond the client cookie
  `maxAge`. Absolute (default 30d) and idle (default 3d) expiry are now enforced
  server-side in `findByCookie` — which the `/visitor` socket handshake also
  goes through, so both the HTTP routes and the socket reject expired sessions.
  A visitor "forget me" endpoint (`POST /visitor/session/forget`) hard-deletes
  the session (also serving geo-privacy deletion) and clears the cookie. Windows
  are configurable via `VISITOR_SESSION_ABSOLUTE_TTL_HOURS` /
  `VISITOR_SESSION_IDLE_TTL_HOURS`. ([#79])
- **CSRF protection on cookie-authenticated visitor routes.** The API had no CSRF
  protection despite cookie-authenticated state-changing endpoints
  (`POST /visitor/chats`, `POST /visitor/heartbeat`); only `SameSite=Lax`
  incidentally blocked the attack — the exact thing #75 must change for the
  widget. Added a stateless synchronizer token (`X-XSRF-TOKEN`, HMAC-bound to the
  visitor cookie, held in the widget's memory — never a cookie an attacker can
  read), issued by the bootstrap endpoints and required on the write routes.
  Bearer-token (console) routes are exempt — CSRF applies only to ambient
  credentials. **Unblocks #75.** ([#77])

### Added

- **Explicit, per-user staff availability with support hours** ([#76]).
  Availability is no longer a side effect of having a Socket.IO connection
  open. Operators set an explicit `available` / `away` status from the console
  Availability page; it is stored per-user in Redis, persists across
  reconnects and reloads, and is unaffected by opening or closing extra tabs.
  A connection grace window (refreshed by a periodic heartbeat) means a
  dropped socket does not immediately mark an agent away. Tenants can
  configure weekly support hours in `Tenant.settings.supportHours` (no
  migration); `anyStaffAvailable` is true only when at least one agent is
  explicitly available AND the tenant is within hours. The `/staff` namespace
  now bridges `support:availability_changed` to the tenant's `/visitor` room,
  so the widget dispatches `support_available` (both true and false) — making
  the proactive-invitation state (§5.1.2) reachable and the no-support state
  (§5.1.4) fire correctly. The widget reads configured support-hours text from
  `/widget/config` instead of the hardcoded `"Mon–Fri, 9am–5pm"`. Status
  changes are announced programmatically (aria-live), visibly, and audibly per
  §3. New `support-set-availability` use case; the alert-sound mute moved to a
  new Preferences page (and its use case). The widget invitation use cases are
  no longer marked unreachable.
- **Consent foundation for the geo-privacy program.** A real, extensible consent
  framework with documented defaults and an audit trail — the base the presence
  gate and GPC handling build on. ([#56])
  - New `consent_records` table + Sequelize model: one durable row per
    tracking decision/consent change, keyed by an anonymous `subject_key` (HMAC
    of the visitor cookie, so it lines up with a tracked session without
    requiring one). IP is minimized to an HMAC (`ip_hash`); the raw address is
    never stored.
  - A **jurisdiction rules engine** (`consent-policy.ts`): a small, versioned,
    data-driven table (`RULE_VERSION`). EU/EEA/UK → opt-in; US/US-CA → opt-out
    (honoring explicit opt-out and GPC); unknown location → strict opt-in (never
    US-max). `functional` is strictly necessary and always granted;
    `presence`/`analytics` are the gated non-essential purposes.
  - **Privacy APIs** under `/api/v1/privacy`: `GET /consent` (side-effect-free
    effective-state read for the widget to gate on), `POST /consent`,
    `POST /consent/withdraw`, and `POST /data-request` (an audited, queued stub).
  - **Tracking-decision audit trail**: every decision emits the §19 event
    vocabulary to `audit_logs` (`privacy.location_resolved` /
    `privacy.location_unknown` / `privacy.geolocation_default_applied`,
    `privacy.rule_applied`, `privacy.gpc_detected` / `privacy.gpc_applied`,
    `privacy.consent_recorded` / `privacy.consent_withdrawn` /
    `privacy.data_request`).
  - Decisions covered by unit tests (EU/US/GPC/unknown) and the APIs by
    integration tests against real MySQL. See
    [ADR-0019](docs/adr/0019-consent-model-and-jurisdiction-policy.md).

- **The widget can work on third-party sites: CORS is now per-tenant.** The API
  reflected only the console origin (`APP_URL`), so every credentialed
  cross-origin widget request was blocked by the browser. Widget-facing routes
  (`/api/v1/visitor/*`, `/api/v1/widget/*`) and the Socket.IO handshake now
  reflect the requesting origin when it belongs to an active tenant's
  `allowed_origins`, set `Vary: Origin`, and reject unknown origins
  (default-deny — see [ADR-0018](docs/adr/0018-widget-cors-default-deny.md));
  console routes keep the strict `APP_URL` policy. Note the widget also needs
  the `SameSite=None` cookie change (#75) to actually work cross-site. ([#74])

- **Custom Semgrep rules** ([#83]) in `.semgrep/rules.yml`, wired into the gate
  by `scripts/semgrep.sh` alongside the registry packs. Twelve project-specific
  rules covering the `secure-project-baseline` §17 categories that fit this
  codebase, which the public packs miss: chat lookups must go through the
  tenant-scoped service, tenant-owned model lookups in handlers need a scoping
  predicate, permissive CORS origin (`origin: true` / `'*'`), CORS reflecting
  the request Origin header, a credentialed CORS config with a single fixed
  origin and no per-tenant callback (the #74 pattern; the first-party `APP_URL`
  console origin is a documented carve-out until #74 lands), `jwt.verify`
  without an `algorithms` pin, `jwt.decode` where verification is required,
  cookies set without `httpOnly` + `secure`, raw SQL built by string
  interpolation, `child_process` exec with an interpolated command, outbound
  `fetch` of a request-controlled URL (SSRF), and dynamic code execution
  (`eval` / `new Function`). Every rule ships a `ruleid:` detect fixture and an
  `ok:` near-miss under `.semgrep/tests/`. The
  `jwt-verify-without-algorithm-pin` rule immediately caught three unpinned
  verifiers (see Fixed). `scripts/semgrep.sh` now skips gracefully when semgrep
  is not on PATH locally (but fails hard in CI so coverage cannot silently
  regress) and excludes the fixtures dir from the scan.

- **API security testing driven by the OpenAPI spec** ([#62]). Three additions,
  all fed from a spec generated by `api/src/scripts/generate-openapi.ts` (which
  serializes the live document without booting the API):
  - **Schemathesis fuzzing** — `scripts/api-fuzz.sh` (npm `security:api-fuzz`)
    generates the spec, targets a running API (`API_TARGET_URL`) or boots the
    local one, and runs `schemathesis run --checks all`. Skips cleanly with an
    install hint when schemathesis is absent, and when a local boot cannot be
    brought up.
  - **A ZAP API scan config** separate from the passive baseline —
    `.github/zap/api-scan-rules.tsv` (owned, commented exclusions).
    `.github/zap/rules.tsv` and `.github/workflows/zap.yml` are untouched.
  - **Spec security validation** — `api/src/config/swagger.security.test.ts`
    asserts `components.securitySchemes` declares the `bearerAuth` (JWT) and
    `visitorCookie` mechanisms and that every non-public operation carries a
    `security` requirement. The schemes are now declared in
    `api/src/config/swagger.ts`.
  - Docs: `docs/security/api-testing.md`. Known gap: only `GET /health` is
    currently registered in the OpenAPI document, so the fuzzer/scan exercise a
    single endpoint until the other routers register their paths.
- **Cookie inventory, vendor disclosure, and a CMP consent hook for the
  embedded widget** ([#54]):
  - `docs/privacy/cookie-inventory.md` documents the only two cookies the widget
    introduces — `livechat_visitor` (first-party, HttpOnly, signed session) and
    `afixt_livechat_muted` (first-party mute preference) — with duration, flags
    and data category; confirms **no** `localStorage`/`sessionStorage` and **no**
    third-party trackers/fonts/analytics (the widget loads only same-origin
    relative endpoints and an inlined audio data-URI).
  - A dependency-free **consent hook** (`widget/src/services/consent.ts`): the
    `data-require-consent` attribute plus
    `window.AfixtLiveChat.setConsent/getConsent/onConsentChange` and an
    `afixt-livechat:consent` DOM event let a host CMP grant/deny before the
    widget captures any presence/analytics data. The widget bootstrap awaits the
    capture gate. Additive integration point for the #56/#53 consent foundation.
  - `docs/privacy/cmp-integration.md` (copy-paste snippet) and
    [ADR-0014][adr-0014] (the hook contract). Bundle stays at 20.7 KB brotli
    (budget 50 KB). New unit tests: consent-hook behavior + a source scan
    asserting no third-party origins.
- **Use-case coverage for eleven previously undocumented interactions**
  ([#66]): widget invitation state (§5.1.2, open + dismiss), widget
  chat-ended / email-transcript state (§5.1.7, send + decline), operator
  end-chat, operator alert-sound mute, admin tenant settings surface
  (embed snippet, allowed origins, rotate embed secret), admin edit user,
  admin invitations list + revoke. Generated Playwright specs committed;
  `admin-view-invitations` and `support-toggle-alert-sound` join the
  runnable e2e projects.

- **Security regression test suite** ([#64], part of the security-baseline
  program): asserts the error envelope never leaks a stack trace, internal
  message, SQL, or filesystem path; that malformed/oversized/wrong-typed and
  injection-ish request bodies are rejected as 4xx (not 500) on the auth and
  visitor routes; that the visitor session cookie carries `HttpOnly` +
  `SameSite=Lax` (and `Secure` in production) and that a forged/tampered signed
  cookie is refused; and that `/staff` (missing/malformed/expired/wrong-secret
  token) and `/visitor` (forged cookie) Socket.IO handshakes are refused.

### Changed

- **No more scheduled GitHub Actions.** All four cron-triggered workflows now
  run at PR time instead of on a timer, so a failure is attributable to the
  change that caused it ([#50]):
  - Link check (`docs.yml`) runs on `pull_request` (path-filtered to Markdown
    and `docs/`) in offline mode; the full external-URL sweep stays available
    via manual dispatch and already runs in `ci.yml`.
  - Lighthouse CI (`lhci.yml`) keeps its existing `pull_request` trigger; only
    the schedule was removed.
  - CodeQL (`security.yml`) runs on `pull_request` and on pushes to
    `main`/`develop`.
  - The OWASP ZAP baseline (`zap.yml`) scans the PR's own UI build served
    locally on the runner; scanning a deployed URL remains available via
    manual dispatch.
- **Use cases now carry `expected_result`, use `extends` for variants, and cover
  more error paths** ([#85]). Every non-`extends` use case gained an
  `expected_result` stating the observable outcome; the `support/login` and
  `widget/chat-ended` variant pairs were converted from duplicated files to
  `extends` + `steps_override`; three `type: negative` cases were added
  (invalid allowed-origin, already-revoked invitation, invalid user role); and
  `usecases/README.md` now documents the positive/negative/extension
  distinction. (The `widget/invitation` pair is handled with #76, which makes
  that state reachable.) `usecases:validate` passes (31 cases) and specs were
  regenerated.

### Fixed

- **A clean clone runs by following the README.** The API read `process.env`
  with no `.env` loading and no example file, so `npm run dev` exited with an
  envalid wall of ~15 missing variables. Added `api/.env.example` with working
  defaults matching the compose ports, `dotenv` loading in development (app,
  migrate, and seed), wired `npm run seed` to the real dev seeder (it was
  `sequelize-cli db:seed:all` against a non-existent seeders dir), documented
  the real steps + dev login accounts in the README, and gave `server.ts` an
  `error` handler so a port clash prints an actionable message instead of an
  `EADDRINUSE` stack trace. ([#81])
- **Integration tests no longer flake under load.** The suite's 10s
  `testTimeout` had no headroom: tests doing several bcrypt-cost-12 hashes plus
  real MySQL round-trips landed near 10s on a busy machine, so unrelated tests
  timed out intermittently and adding any new integration test destabilised
  existing ones. Test-environment bcrypt cost is now 4 (production/dev stay at
  12, asserted by `bcrypt-cost.test.ts`), and the integration `testTimeout` is
  raised to 30s. ([#71])
- **`npm ci --omit=dev` no longer crashes on the `prepare` hook.** The root
  `prepare` script ran `husky` unconditionally, so any production install — the
  `api/Dockerfile` runtime image and the `.do/app.yaml` migrate job — failed with
  `husky: command not found` once devDependencies were omitted. Guarded as
  `husky || true`, husky's documented pattern for CI/production installs. ([#60])
- The admin "Allowed origins" textarea had no accessible name — the section
  heading above it is not a label. It now carries an explicit one, targeted
  by the new `admin-edit-tenant-settings` use case. ([#66])
- **The API now actually shuts down.** `SIGTERM` left the process alive
  indefinitely whenever any Socket.IO client was connected: `http.Server#close()`
  never closes established connections, so the close callback never fired and
  MySQL/Redis were never released. The orphaned process kept serving every
  connected widget and console session, so a restarted API received no traffic
  from existing clients and deploys silently did not take effect for them.
  Socket.IO clients are now disconnected (with a transport close, so they
  reconnect to the replacement instance), idle connections are dropped, and the
  force-exit fallback calls `process.exit()` instead of assigning
  `process.exitCode`, which does nothing while the event loop is busy ([#68]).
- **JWT verification now pins `algorithms: ['HS256']`** at all three verify
  call sites — `middlewares/authenticate.ts`, `io/staff-namespace.ts`, and
  `services/auth-service.ts` — surfaced by the new
  `jwt-verify-without-algorithm-pin` Semgrep rule. Without a pin, `jwt.verify`
  accepts whatever algorithm the token header claims (algorithm-confusion /
  `alg: none` footgun). All tokens are signed HS256, so the pin is a pure
  hardening with no behavior change. ([#83])
- **Malformed and oversized request bodies now return a client 4xx, not 500**
  ([#64]). Body-parser failures (invalid JSON, a payload beyond the 1 MB JSON
  limit, unsupported charset) previously fell through to the generic
  `500 Internal server error` branch. The error handler now maps them to
  `400 Malformed request body` / `413 Request payload too large` /
  `415 Unsupported media type` with a fixed, non-leaking message (the offending
  payload slice body-parser puts in `err.message` is never echoed).

[#57]: https://github.com/AFixt/livechat/issues/57
[#121]: https://github.com/AFixt/livechat/issues/121
[#123]: https://github.com/AFixt/livechat/issues/123
[#119]: https://github.com/AFixt/livechat/issues/119
[#125]: https://github.com/AFixt/livechat/issues/125
[#129]: https://github.com/AFixt/livechat/issues/129
[#131]: https://github.com/AFixt/livechat/issues/131
[#130]: https://github.com/AFixt/livechat/issues/130
[#53]: https://github.com/AFixt/livechat/issues/53
[#55]: https://github.com/AFixt/livechat/issues/55
[#56]: https://github.com/AFixt/livechat/issues/56
[#75]: https://github.com/AFixt/livechat/issues/75
[ADR-0021]: docs/adr/0021-visitor-session-third-party-cookie-fallback.md
[#132]: https://github.com/AFixt/livechat/issues/132
[#66]: https://github.com/AFixt/livechat/issues/66
[#68]: https://github.com/AFixt/livechat/issues/68
[#80]: https://github.com/AFixt/livechat/issues/80
[#69]: https://github.com/AFixt/livechat/issues/69
[#73]: https://github.com/AFixt/livechat/issues/73
[#76]: https://github.com/AFixt/livechat/issues/76
[adr-0020]: docs/adr/0020-geo-retention-minimization.md

[#56]: https://github.com/AFixt/livechat/issues/56

[#64]: https://github.com/AFixt/livechat/issues/64
[#50]: https://github.com/AFixt/livechat/issues/50
[#54]: https://github.com/AFixt/livechat/issues/54
[#58]: https://github.com/AFixt/livechat/issues/58
[#59]: https://github.com/AFixt/livechat/issues/59
[#60]: https://github.com/AFixt/livechat/issues/60
[#61]: https://github.com/AFixt/livechat/issues/61
[#62]: https://github.com/AFixt/livechat/issues/62
[#63]: https://github.com/AFixt/livechat/issues/63
[#65]: https://github.com/AFixt/livechat/issues/65
[#77]: https://github.com/AFixt/livechat/issues/77
[#79]: https://github.com/AFixt/livechat/issues/79
[#72]: https://github.com/AFixt/livechat/issues/72
[#74]: https://github.com/AFixt/livechat/issues/74
[#80]: https://github.com/AFixt/livechat/issues/80
[ADR-0017]: docs/adr/0017-defer-chat-attachments.md
[#81]: https://github.com/AFixt/livechat/issues/81
[#71]: https://github.com/AFixt/livechat/issues/71
[#78]: https://github.com/AFixt/livechat/issues/78
[#82]: https://github.com/AFixt/livechat/issues/82
[#83]: https://github.com/AFixt/livechat/issues/83
[#84]: https://github.com/AFixt/livechat/issues/84
[#85]: https://github.com/AFixt/livechat/issues/85
[ADR-0013]: docs/adr/0013-jwt-localstorage-risk-acceptance.md
[adr-0014]: docs/adr/0014-widget-consent-hook.md

## [0.2.0] - 2026-07-23

Audit logging works. It was built but never called, so `audit_logs` stayed
empty in a running system.

### Added

- **Audit logging is wired up.** `createAuditService()` was constructed and
  exposed as `services.audit`, but `record()` had no call sites anywhere — the
  table, model and service all worked and none of them were ever reached.
  CLAUDE.md asks for "every auth + admin action"; none of it happened. ([#46],
  [#47])

  Now recorded:
  - **Auth** — `register`, `login`, `login_failed`, `logout`,
    `password_reset_requested`, `password_reset`, `password_changed`,
    `email_verified`. Failed logins are audited too, since a run of them is the
    signal worth having.
  - **Admin mutations** — tenant `create`/`update`/`delete`/
    `rotate_embed_secret` and `user.update`, against the affected resource
    rather than the actor's own tenant.
  - **Authorization denials** — captured centrally in the error handler, which
    already sees every `ApiError`: 401 becomes `auth.denied`, 403 becomes
    `access.denied`. This closes the loop on the tenant isolation added in
    0.1.2 — a cross-tenant probe now leaves a trail naming the actor.

  Entries carry the actor, tenant, resource, IP and user-agent. Deliberately
  never recorded: the attempted password on a failed login, or a rotated embed
  secret. Both are asserted in tests.

### Fixed

- Integration `beforeAll` timeout raised from 20s to 60s. That hook drops every
  table and replays the migrations per file, which intermittently exceeded 20s
  under load and failed `check:all`. ([#47])

[#46]: https://github.com/AFixt/livechat/issues/46
[#47]: https://github.com/AFixt/livechat/pull/47

## [0.1.2] - 2026-07-23

A security release. The REST API enforced role but not tenant, so a
tenant-scoped operator could reach another tenant's data. Also makes the
coverage gate real rather than decorative.

### Security

- **The REST API now enforces tenant isolation.** A tenant-scoped `admin` or
  `staff` could read — and in places modify — another tenant's chats, users and
  tenants over HTTP: list endpoints filtered on a caller-supplied
  `?tenantId` (omitting it returned every tenant's rows), and by-id routes
  never compared the record's tenant to the caller's.
  `requireTenantAccess()` existed but was dead code, and would not have helped
  if wired up — it returned early for `super_admin`/`admin`/`staff`, so it only
  ever constrained `client`. Replaced with `callerTenantScope()`,
  `assertTenantAccess()` and `resolveTenantFilter()`, keyed on the caller's own
  `tenant_id` rather than their role, and applied across chats, users and
  tenants. Lists are pinned to the caller's tenant; naming another tenant is a
  403 rather than a silent rewrite. Untenanted AFixt staff still span every
  tenant, per the issue #19 decision. ([#43], [#44])

  The Socket.IO layer was already isolated, which is why this went unnoticed —
  one layer was tested and the adjacent one was not, the same shape as the
  migration drift fixed in 0.1.1.

### Fixed

- **The e2e stack no longer fails on a fresh MySQL volume.** The entrypoint's
  temporary init server accepts `CREATE DATABASE`, so the readiness gate could
  pass against it and the real server would then drop the seed's connection
  mid-migration (`PROTOCOL_CONNECTION_LOST`). Setup now waits for the init
  phase to complete before provisioning, and retries the seed. ([#44])

### Changed

- **Coverage thresholds are enforced.** `check:all` ran `test`, not
  `test:coverage`, so the 80/75/80/80 thresholds in `api/vitest.config.ts` were
  decorative and the project sat below its own bar. It now runs `test:ci`,
  which runs the api suite once under coverage; plain `npm test` stays fast for
  local work. Coverage went from 64.30/39.53/73.99/69.11 to
  93.24/80.89/98.64/96.65, with the api suite growing from 22 to 191 tests
  (197 including the isolation tests above). ([#42])

[#42]: https://github.com/AFixt/livechat/pull/42
[#43]: https://github.com/AFixt/livechat/issues/43
[#44]: https://github.com/AFixt/livechat/pull/44

## [0.1.1] - 2026-07-22

A correctness release. v0.1.0 shipped a database schema the ORM could not read
on six tables; this fixes that and closes the testing gap that let it through.

### Fixed

- **The widget could not start a chat.** `POST /api/v1/visitor/chats` returned
  500 with `Unknown column 'deleted_at' in 'field list'`. `paranoid: true` is a
  global Sequelize `define` default, so every model selects `deleted_at` and
  filters on it, but six `createTable` migrations never created the column —
  `visitor_sessions`, `chat_events`, `user_sessions`, `jwt_blacklist`,
  `audit_logs`, `staff_tenants`. Any read against those tables failed on a
  migration-created database. ([#37])
- **e2e stack failed to start on a fresh MySQL volume.** The readiness probe
  passed against the entrypoint's temporary init server, which then shut down
  before the real server started, so the next statement hit a dead socket and
  took the api webServer down with it. ([#38])

### Changed

- **Test schemas are built from the real migrations, not `sync({ force: true })`.**
  Both the API integration harness and the e2e seeder now drop every table and
  replay `api/src/db/migrations` via the new `api/src/db/migrator.ts`. Building
  from the models made the models the source of truth for both the code under
  test and the schema it ran against, so migration drift was structurally
  invisible — which is how the bug above shipped with every suite green.
  ([#38], [#39])
- **Integration tests actually run in CI.** The `check` job starts MySQL and
  Redis and runs with `REQUIRE_DB=1`, so an unreachable stack fails loudly.
  Previously the job had no database, every integration test returned early,
  and CI reported the same "22 passed" whether or not one existed. Local runs
  without the flag still skip, so `npm test` works with no Docker. ([#40])

### Added

- A static migration-drift guard (`api/tests/unit/migration-schema-drift.test.ts`)
  that replays the migrations and asserts each table ends up with the columns
  the global define defaults require. Needs no database. ([#37])
- `CHANGELOG.md`, and a README note on `@afixt/*` scoped packages and
  `NPM_TOKEN` (a 404 there is an auth failure, not a missing package).
  ([#35], [#36])

## [0.1.0] - 2026-07-22

First tagged release. Everything below had accumulated on `develop`; `master`
had never carried any of it. The product is pre-1.0 and not yet deployed.

### Added

- **Widget conversation states are reachable.** `no_support`,
  `support_initiated`, and `restart` were rendered but nothing ever dispatched
  to them. The widget now branches on staff availability when a visitor
  initiates, the support console can start a chat from the visitor presence
  list, and a returning visitor is offered to resume a prior conversation.
  ([#29], closes [#21])

### Fixed

- **Untenanted staff receive real-time events.** AFixt staff with no tenant of
  their own joined no `tenant:{id}` socket room, so the support console sat
  silent while visitors chatted. They now join a `staff:global` room that
  visitor and chat events are mirrored to; tenant-scoped agents remain isolated
  to their own tenant. ([#30], closes [#19])
- **Widget form-field borders are visible** — WCAG 1.4.11 non-text contrast.
- **Lockfile and CI drift** — excluded dead `output.jsbin.com` demo links from
  the lychee gate, which had been failing every pull request with zero real
  errors.

### Changed

- **Secret scanning: gitleaks → trufflehog.** The gate now fails only on
  *verified* credentials, and the trufflehog action is fully open source.
  (ADR-0008, [#28], closes [#3])
- **Database TLS is env-driven** — `DB_SSL` / `DB_SSL_CA`, off for local
  docker-compose and on in production. ([#31])
- **GitHub Actions keep mutable major tags.** With Dependabot disabled,
  SHA-pinning would freeze every action and cut off upstream security fixes with
  no bumper to restore them. (ADR-0010, [#33], closes [#7])
- **Lighthouse CI no longer gates the SEO category**, which conflicts with the
  console's deliberate `noindex`. Performance and best-practices budgets are
  unchanged. (ADR-0009, [#32])
- **SEO/AIEO tooling ruled not-applicable** — the widget is embedded in host
  pages and the console is a private authenticated SPA, so neither has a
  crawlable surface. (ADR-0009, closes [#1])

### Removed

- **axe-core**, via removal of `eslint-plugin-jsx-a11y` — its only transitive
  source — per project policy. Accessibility checking uses
  `@afixt/a11y-assert`. ([#26], [#27], closes [#25])
- **The OWASP Dependency-Check job.** It was the only `@main` branch reference,
  is effectively unmaintained (last release 2021), and added little over
  `npm audit`, `osv-scanner`, and CodeQL for an npm/TypeScript repository.
  (ADR-0010, [#33])

### Security

- Verified-secret scanning at pre-commit, pre-push, and in CI (trufflehog).
- TLS available on the database connection in production.
- `min-release-age=7` in `.npmrc` — a supply-chain cooldown before adopting
  brand-new releases. Enforced by npm >= 11.10; inert under the npm 10 that
  ships with Node 22, and effective on toolchain upgrade.
- `body-parser` bumped to 2.3.0, clearing OSV `GHSA-v422-hmwv-36x6`.

[Unreleased]: https://github.com/AFixt/livechat/compare/v0.3.1...HEAD
[0.3.1]: https://github.com/AFixt/livechat/compare/v0.3.0...v0.3.1
[0.3.0]: https://github.com/AFixt/livechat/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/AFixt/livechat/compare/v0.1.2...v0.2.0
[0.1.2]: https://github.com/AFixt/livechat/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/AFixt/livechat/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/AFixt/livechat/releases/tag/v0.1.0
[#1]: https://github.com/AFixt/livechat/issues/1
[#3]: https://github.com/AFixt/livechat/issues/3
[#7]: https://github.com/AFixt/livechat/issues/7
[#19]: https://github.com/AFixt/livechat/issues/19
[#21]: https://github.com/AFixt/livechat/issues/21
[#25]: https://github.com/AFixt/livechat/issues/25
[#26]: https://github.com/AFixt/livechat/pull/26
[#27]: https://github.com/AFixt/livechat/pull/27
[#28]: https://github.com/AFixt/livechat/pull/28
[#29]: https://github.com/AFixt/livechat/pull/29
[#30]: https://github.com/AFixt/livechat/pull/30
[#31]: https://github.com/AFixt/livechat/pull/31
[#32]: https://github.com/AFixt/livechat/pull/32
[#33]: https://github.com/AFixt/livechat/pull/33
[#35]: https://github.com/AFixt/livechat/pull/35
[#36]: https://github.com/AFixt/livechat/pull/36
[#37]: https://github.com/AFixt/livechat/pull/37
[#38]: https://github.com/AFixt/livechat/pull/38
[#39]: https://github.com/AFixt/livechat/pull/39
[#40]: https://github.com/AFixt/livechat/pull/40
[#153]: https://github.com/AFixt/livechat/issues/153
[#155]: https://github.com/AFixt/livechat/issues/155
