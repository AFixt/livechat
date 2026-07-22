# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with
code in this repository.

## Project overview

Accessibility-first live chat support widget, embeddable on arbitrary client
websites via a JS snippet. Multi-tenant SaaS: AFixt hosts the service; each
client website is a tenant with its own invited users. The system has three UIs:

- **Customer widget** (embedded on client sites) — the anonymous or
  token-identified visitor talking to support
- **Support console** (AFixt staff) — real-time visitor list, multi-session chat
- **Admin console** (AFixt super_admin/admin) — tenant provisioning, user
  invitations, billing, settings

Full product spec: `requirements.md`. **Accessibility is the core
differentiator** (§4.1) — every feature must pass `@afixt/a11y-assert` at
component, E2E, and CI-preview layers. Alerts must be programmatic, visible,
_and_ audible (§3) — all three, not a choice.

## Repo status

Greenfield. Only `README.md`, `requirements.md`, and this file exist. The
implementation plan is tracked in `docs/plan.md` (or GitHub issues) and
sequenced in phases. Expect multiple `docs/adr/NNNN-*.md` records as decisions
land.

## Tech stack

Aligned with GitHub issue #1 ("Adopt standardized quality, security, a11y, and
performance tooling stack") and the help-desk reference architecture. Greenfield
means we adopt the **target** stack without legacy carry-over.

### Backend (`api/`)

- **Runtime:** Node 22 (pinned via `.nvmrc` + `.node-version`;
  `engine-strict=true`)
- **Language:** TypeScript with `strict: true` + `noUncheckedIndexedAccess` +
  `exactOptionalPropertyTypes` + `noImplicitOverride`.
  `@total-typescript/ts-reset` imported in `src/reset.d.ts`.
- **Framework:** Express 5
- **Dev runtime:** `tsx`. **Build:** `tsup` or `tsc`.
- **ORM:** Sequelize 6, MySQL 8. UUID primary keys + `inc` auto-increment column
  on every model. `paranoid: true` (soft deletes), `underscored: true`,
  `timestamps: true`. Migrations via `sequelize-cli`.
- **Cache / pub-sub / rate-limit store:** Redis 7 (`ioredis`). Used for JWT
  blacklist, rate-limit counters, and Socket.IO adapter in production.
- **Real-time:** `socket.io` — JWT-authenticated on handshake. Rooms: `staff`,
  `tenant:{id}`, `user:{id}`, `visitor:{sessionId}`, `chat:{chatId}`.
- **Auth:** JWT access + refresh token pair. Access token short-lived (~15 min),
  refresh rotated on use and stored hashed in `user_sessions`. Blacklist via
  Redis (`bl:{jti}`) + `jwt_blacklist` table. `bcryptjs` @ cost 12 for password
  hashing. See "Auth & multi-tenancy" below.
- **Validation:** `zod` for all request bodies/params/queries. `envalid` for env
  var validation at boot. Controllers receive already-parsed typed input from
  middleware.
- **Logging:** `pino` (structured JSON). Correlation ID middleware on every
  request.
- **Security middleware:** `helmet`, `cors` (restrictive origin),
  `express-rate-limit` (with `rate-limit-redis`), `express-slow-down` on auth
  endpoints, `cookie-parser`, CSRF middleware, `compression`.
- **Email:** `nodemailer`. Dev via MailHog in docker-compose.
- **Object storage:** `@aws-sdk/client-s3` for attachments; presigned URLs only.
- **API docs:** OpenAPI via `zod-to-openapi`, served at `/api/docs`.
- **Testing:** **Vitest** (unit + integration) with v8 coverage, 80%+
  thresholds. `supertest` for route tests. `msw` for outbound HTTP mocking. Real
  MySQL + Redis in integration tests (Testcontainers or docker-compose test
  profile) — not mocks.

### Frontend: support/admin console (`ui/`)

- React 19 + TypeScript + Vite 6
- MUI 7 (`@mui/material`, `@emotion/react`, `@emotion/styled`)
- `@tanstack/react-query` for server state, **Zustand** for local UI state
- `react-router-dom` 7, `react-hook-form`, `zod` (shared schemas with API),
  `dompurify` for any rich-text rendering
- `socket.io-client` for real-time
- `i18next` + `react-i18next`
- **Testing:** Vitest + React Testing Library; `@afixt/a11y-assert` on every
  rendered component. Playwright for E2E, with `@afixt/a11y-assert` on each key
  flow.

### Frontend: customer widget (`widget/`)

- **Hard size budget.** Ship vanilla TS + Preact (or solid-js) — _not_ React —
  to keep bundle under budget enforced by `size-limit`.
- Web Component wrapper so it doesn't collide with the host page's
  React/Vue/etc.
- Shadow DOM isolation for styles — but **exposes focus and keeps an accessible
  name tree through the shadow boundary** (test this explicitly).
- No third-party fonts, no trackers, no analytics SDKs.
- Accessibility budget: zero `@afixt/a11y-assert` violations against the built
  preview.

### Tooling (root)

Per issue #1 — the full stack is the mandate, not a suggestion:

- Husky pre-commit (`lint-staged` + `tsc-files --noEmit` + `trufflehog` secret
  scan of staged files)
- Husky commit-msg (`commitlint` / Conventional Commits)
- Husky pre-push (`npm run check:all`)
- ESLint flat config (`eslint.config.js`) with `@typescript-eslint`
  `strict-type-checked` and `stylistic-type-checked`, plus `react`,
  `react-hooks`, `react-refresh`, `sonarjs`, `security`, `unicorn`, `import-x`,
  `promise`, `n`, `jsdoc`, `no-secrets`
- Prettier + `prettier-plugin-organize-imports`
- Stylelint + `stylelint-config-standard` + `@double-great/stylelint-a11y`
- `markdownlint-cli2`
- `jscpd` (dup detection, `--threshold 1 --min-tokens 50`)
- `lychee` (Markdown link check)
- `license-checker-rseidelsohn` (allowlist-only licenses)
- `size-limit` (build gate)
- Lighthouse CI (perf/SEO/best-practices; a11y is covered by `a11y-assert`)
- Security: `npm audit`, `osv-scanner`, `semgrep` (OWASP Top 10), `trufflehog`
  (secret scanning), `eslint-plugin-no-secrets`, scheduled CodeQL + OWASP ZAP
  baseline in Actions

**Local gates are preferred over GitHub Actions.** Keep CI as a safety net for
`--no-verify` / web-UI merges.

## Monorepo layout

```text
api/          Express + Sequelize backend (TypeScript)
ui/           Support & admin console (React + Vite)
widget/       Customer-facing embeddable widget (Preact + Web Component)
shared/       Shared Zod schemas, types, constants used by api/ui/widget
usecases/     *.uc.yaml — canonical definition of every user interaction
docs/
  adr/        Architecture Decision Records
  templates/  ADR + README templates
scripts/
docker-compose.yml
docker-compose.prod.yml
```

## Auth & multi-tenancy — follow help-desk exactly

This livechat product mirrors `AFixt/help-desk`'s identity model. Do not
reinvent. The exceptions below are additive (visitor sessions), not
replacements.

### Core identity (copied from help-desk)

- **Roles:** `super_admin`, `admin`, `staff`, `client` (+ `visitor` — see below)
- **Tenant** has: `id` (UUID), `inc` (MEDIUMINT auto-inc, unique), `name`,
  `slug` (lowercase+hyphen regex), `domain`, `status`
  (active/suspended/archived), `expires_at`, `settings` (JSON). Paranoid +
  underscored.
- **User** has: `id` (UUID), `inc`, `email` (lowercased), `password_hash`
  (bcrypt cost 12 via Sequelize hook), `first_name`, `last_name`, `role`,
  `tenant_id` (nullable for super_admin/staff), `email_verified` + verification
  token/expiry, `password_reset_token` + expiry, `failed_login_attempts`,
  `locked_until` (30 min after 5 fails), `status`
  (active/suspended/pending/deactivated), `last_login_at`, `preferences` (JSON).
  `toSafeJSON()` strips all sensitive fields.
- **Invitation** model with tokenized, role-scoped, expiring invites — users
  register only via `POST /auth/register` with a valid invitation token. Status:
  pending/accepted/expired/revoked.
- **UserSession** — one row per active refresh token (hashed). Destroyed on
  logout, password change, and password reset.
- **JwtBlacklist** — access-token JTI invalidation, mirrored in Redis
  (`bl:{jti}`) with TTL equal to remaining token lifetime.
- **StaffTenant** — through-table so staff can be scoped to a subset of tenants
  if needed (many-to-many).
- **AuditLog** — every auth + admin action.
- **Middlewares:** `authenticate` (verifies JWT, checks blacklist, loads user,
  enforces `tenant.expires_at`) and `authorize.requireRole(...roles)` /
  `requireTenantAccess()` / `requireStaffOrAdmin()`.
- **Socket.IO auth:** JWT on handshake (not cookies). On connect: join
  `user:{id}`, `staff` if staff+, `tenant:{id}` if tenanted.

### Livechat-specific additions (not in help-desk)

- **Visitor sessions** — anonymous or customer-token-identified site visitors
  are _not_ Users. They're represented by a `visitor_sessions` row keyed by a
  signed cookie session ID, scoped to a tenant, carrying UA + geo + current
  URL + chat-history pointer. Visitors join `visitor:{sessionId}` socket room.
  Staff join `tenant:{tenantId}:visitors` to receive presence events.
- **Customer identity token** (§3 of requirements.md) — an optional signed JWT
  minted by the client's backend using a shared secret, passed to the widget at
  init, letting the client correlate chats with their own user records. Verified
  server-side; never trusted blindly.

## Every user interaction is documented as a use case — mandate

**Rule:** every user-facing interaction — customer widget flows, support console
actions, admin flows — MUST have a corresponding `.uc.yaml` file in `usecases/`
following the `@afixt/usecase-runner` DSL.

- The YAML is the source of truth for behavior. When behavior changes, update
  the use case _first_, then the implementation.
- Format: six core keywords (`locate`, `focus`, `enter`, `select`, `activate`,
  `verify`) plus supplementary (`wait`, `wait_for`, `navigate`, `screenshot`,
  `keyboard`, `scroll`, `note`). Element targeting uses `getByRole()` /
  `getByLabel()` only — if an element isn't in the accessibility tree, the test
  fails, and that's intentional.
- Files use `.uc.yaml` extension. One use case per file.
- `@afixt/usecase-runner generate` produces Playwright `.spec.ts` files into
  `ui/e2e/generated/` and `widget/e2e/generated/`. Generated specs are committed
  but marked auto-generated — never hand-edit.
- `@afixt/usecase-runner validate usecases/` runs in pre-push and CI.
- Organize as: `usecases/widget/<flow>.uc.yaml`,
  `usecases/support/<flow>.uc.yaml`, `usecases/admin/<flow>.uc.yaml`. Negative
  and extension cases (`type: negative` / `type: extension`) are required for
  error paths and state variants (no-support-available, support-initiated,
  restart-chat, etc.).
- **Coverage rule for PRs:** if a PR adds or modifies a user interaction without
  a matching `.uc.yaml` change, CI fails.

See `AFixt/usecase-runner/spec.md` for DSL reference and
`AFixt/usecase-runner/meetabl-login-sample.yml` for an example.

## Coding conventions

- **ES modules** throughout (both api and ui). No CommonJS.
- **TypeScript strict.** `any` is an ESLint error. Non-null assertions are an
  ESLint error. Use Zod + `z.infer` rather than hand-written DTO types where
  input is involved.
- **File size:** ESLint `max-lines` 300, `max-lines-per-function` 75, complexity
  10, `max-depth` 4, `max-params` 4. Split before fighting the linter.
- **Commits:** Conventional Commits enforced by commitlint (e.g.,
  `feat(widget): add audible alert`,
  `fix(api): invalidate session on pw reset`).
- **No default exports** outside framework conventions (`pages/`, `routes/`,
  `*.stories.tsx`).
- **API response envelope:** `{ success, data, message, pagination? }`. All
  routes under `/api/v1/`.
- **JSDoc/TSDoc required on exported functions, types, and interfaces**
  (enforced by `eslint-plugin-jsdoc`).
- **Co-located tests.** `foo.ts` lives next to `foo.test.ts`.
- **ADRs.** Every significant decision goes in `docs/adr/NNNN-title.md` using
  `docs/templates/ADR.template.md`.

## Common commands

Once scaffolded, root-level scripts mirror the house pattern:

- `npm run dev` — run api, ui, widget in parallel (concurrently)
- `npm run check` — `lint` + `typecheck` + `stylelint` + `markdownlint`
- `npm run check:all` — `check` + `test` + `build` + `size` + `dupes` +
  `links` + `security` + `license:check` (pre-push gate)
- `npm test` — Vitest across workspaces
- `npm run test:e2e` — Playwright + usecase-runner generated specs
- `npm run usecases:validate` — `usecase-runner validate usecases/`
- `npm run usecases:generate` — regenerate Playwright specs from `.uc.yaml`
- `docker compose up` — MySQL + Redis + MailHog + MinIO + api + ui +
  widget-preview

## Context hygiene for Claude

- Per issue #1, this file stays under ~200 lines. Link out to `requirements.md`,
  `docs/adr/`, and per-subsystem `CLAUDE.md` files rather than inlining.
- Non-obvious subsystems (`widget/`, `usecases/`, anything touching
  accessibility tree across shadow DOM) get their own `CLAUDE.md`.
- Strict types + Zod schemas + TSDoc exist so Claude can read _signatures_
  rather than implementations.

## Reviewing PRs

Whenever I ask to review a PR (pull request), use the `pr-review` skill.

## axe-core is banned

**`axe-core` must never be used in this project — directly or transitively.**

- Do not add `axe-core` or any `@axe-core/*` package.
- Do not add any dependency that pulls in `axe-core` transitively — this
  includes `eslint-plugin-jsx-a11y`, `lighthouse` / `@lhci/cli`, `pa11y`,
  `@storybook/addon-a11y`, `jest-axe`, `cypress-axe`, and similar.
- Before adding any new dependency, verify with `npm ls axe-core` that it does
  not introduce axe-core into the tree. If it does, do not add it.
- Use `@afixt/a11y-assert` for accessibility checks instead.
