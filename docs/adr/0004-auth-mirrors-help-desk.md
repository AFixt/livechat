# ADR-0004: Auth and multi-tenancy mirror AFixt/help-desk

- **Status:** Accepted
- **Date:** 2026-04-24
- **Deciders:** Karl Groves

## Context

`AFixt/help-desk` has a battle-tested identity model: Tenant + User +
Invitation + UserSession + JwtBlacklist + StaffTenant + AuditLog, roles
`super_admin|admin|staff|client`, JWT access + refresh with Redis-backed
blacklist, bcrypt cost 12, account lockout after 5 failed attempts, tenant
expiration enforcement, Socket.IO JWT on handshake joining `user:{id}` / `staff`
/ `tenant:{id}` rooms.

The livechat product has the same shape of identity concerns: AFixt admins
provision tenants, invite primary users, users have roles, staff serve all
tenants. Reinventing these primitives is pure downside.

## Decision

Port help-desk's identity stack line-for-line into livechat, converting it to
TypeScript and replacing `express-validator` with `zod` as we go. The following
are copied without modification to shape:

- Models: `Tenant`, `User`, `Invitation`, `UserSession`, `JwtBlacklist`,
  `StaffTenant`, `AuditLog`. UUID primary keys with `inc` MEDIUMINT auto-inc,
  paranoid + underscored + timestamps. `User.toSafeJSON()`,
  `User.generateAccessToken()`/`generateRefreshToken()`, `User.isLocked()` +
  `incrementFailedAttempts()`/`resetFailedAttempts()`, `Invitation.isExpired()`.
- `authService`: `register` (invitation-gated), `login` (lockout-aware,
  increments on failure, resets + updates `last_login_at` on success), `logout`
  (blacklist JTI in Redis + DB, destroy sessions), `refreshToken` (rotate +
  re-hash in `user_sessions`), `verifyEmail`, `forgotPassword` (always returns
  generic message to prevent enumeration), `resetPassword` (invalidates all
  sessions), `changePassword`, `getMe`.
- Middlewares: `authenticate` (JWT verify, Redis blacklist check, user load, and
  tenant-expiry enforcement for non-super-admin users); `authorize`
  (`requireRole`, `requireTenantAccess`, `requireStaffOrAdmin`).
- Socket.IO handshake authenticates via JWT on `socket.handshake.auth.token`. On
  connect: join `user:{id}`, `staff` (if staff+), `tenant:{id}` (if tenanted).

**Livechat-specific additions** (additive, not replacements):

- `VisitorSession` model for anonymous or tokenized site visitors. Visitors are
  not Users. A signed cookie session ID is the identifier.
- Customer identity token (requirements.md §3): tenant-scoped HS256 JWT minted
  by the client's own backend, passed to the widget at init. The visitor remains
  a VisitorSession; the token's `sub` is stored on the VisitorSession for
  correlation.
- Separate Socket.IO namespace for visitors. Staff/admin use the JWT-auth'd
  namespace; visitors use a cookie-signed-token namespace.

## Consequences

**Easier:**

- One mental model for identity across AFixt products
- Known attack surface; known mitigations (lockout, blacklist, rotation)
- Migrations between help-desk and livechat don't require identity re-think

**Harder:**

- If help-desk's auth model changes, we should port the change; the relationship
  is "shared design," not "shared code." A future extraction into a
  `@afixt/identity` package is a candidate (ADR TBD).

## Alternatives considered

- **Lucia Auth / Auth.js / similar library** — rejected; would diverge from
  help-desk's model and lose bespoke features (tenant expiration, StaffTenant
  many-to-many, audit logging).
- **Session cookies instead of JWT** — rejected; Socket.IO handshake is simpler
  with a bearer token, and we already need refresh-token rotation for long-lived
  sessions.

## Links

- `/users/karlgroves/projects/AFixt/help-desk/api/src/models/`
- `/users/karlgroves/projects/AFixt/help-desk/api/src/services/authService.js`
- `/users/karlgroves/projects/AFixt/help-desk/api/src/middlewares/{authenticate,authorize}.js`
- `/users/karlgroves/projects/AFixt/help-desk/api/src/config/socket.js`
- requirements.md §3
