# ADR-0019: Consent records + jurisdiction policy engine

- **Status:** Accepted
- **Date:** 2026-08-15
- **Deciders:** Karl Groves

## Context

The widget begins tracking every visitor on page load — IP, user-agent, current
URL, referrer, and continuous per-URL heartbeats — before any interaction and
with no consent gate of any kind (issues #53, #55, #56). There was no consent
storage, no notion of jurisdiction, no way to honor a Global Privacy Control
(GPC) signal, and no audit trail of _why_ a given visitor was or was not
tracked.

The geo-privacy program needs a real, extensible consent framework. It does
**not** need an exhaustive legal-compliance engine: the product ships zero
analytics/marketing/advertising tags (CLAUDE.md bans third-party trackers), so
the only non-essential processing to govern today is ambient presence tracking.
The goal is sane, documented defaults plus an audit trail — a foundation the
gate (#53) and GPC handling (#55) build on.

## Decision

### 1. A `consent_records` table is the durable decision + consent log

One row is written every time a tracking decision is made or changed (page load,
banner action, GPC signal). The newest row for a `subject_key` is the visitor's
current state. Columns: jurisdiction, `legal_basis`, `source`
(`gpc`/`banner`/`default`), `gpc`, `rule_version`, `purposes` (the effective
per-purpose state), a minimized `ip_hash`, and `user_agent`. Paranoid +
`underscored` + UUID/`inc` like every other model.

- **Subject key, not user identity.** Visitors are anonymous. The subject is an
  HMAC of the signed visitor cookie's session id — it equals
  `visitor_sessions.session_cookie_hash`, so consent lines up with a tracked
  session when one exists but does not _require_ one. This is what lets an
  opt-in-jurisdiction visitor carry consent while no `visitor_sessions` row (no
  PII) exists yet (#53).
- **IP minimization.** The raw IP is never stored on this table. `ip_hash` is an
  HMAC-SHA256 of the address keyed by `COOKIE_SECRET` — enough to prove a record
  is tied to an origin without retaining the address itself. This is the
  minimization intent of the sibling #57 work, applied locally here.

### 2. Three purposes: `functional`, `presence`, `analytics`

`functional` is strictly necessary (session cookie at chat start, message
delivery) and is **always** granted — never gated. `presence` (ambient visitor
tracking) and `analytics` (reserved for any future aggregate measurement) are
non-essential and are what the rules govern.

### 3. The jurisdiction ruleset is a small, versioned, in-code table

`api/src/services/consent-policy.ts` holds a data-driven table plus a
`RULE_VERSION` stamp recorded on every decision:

| Jurisdiction | functional | presence | analytics | GPC honored |
| ------------ | ---------- | -------- | --------- | ----------- |
| EU / EEA     | always     | opt-in   | opt-in    | yes         |
| UK           | always     | opt-in   | opt-in    | yes         |
| US-CA        | always     | opt-out  | opt-out   | yes         |
| US (other)   | always     | opt-out  | opt-out   | yes         |
| **UNKNOWN**  | always     | opt-in   | opt-in    | yes         |

Defaults chosen:

- **EU/EEA/UK → opt-in.** Non-essential tracking is denied until the visitor
  explicitly grants it (GDPR/PECR posture).
- **US / US-CA → opt-out.** Permitted by default, honoring an explicit opt-out
  or a GPC signal (CCPA/CPRA posture). California is labelled distinctly for the
  audit trail; behaviour matches other US states today.
- **Unknown location → strict (opt-in), _not_ US-max.** When geo is unresolved
  the fail-safe is the stricter regime. The `visitor_sessions.country` column is
  not yet populated (no geo lookup exists), so **today every visitor resolves to
  UNKNOWN** unless an edge proxy supplies a country hint — the framework reads
  an optional `country`/`region` hint so a future geo source drops in without
  touching the engine.
- **GPC is honored universally.** A detected signal suppresses every
  non-essential purpose in every jurisdiction, unless the visitor later
  explicitly re-grants. Honoring GPC where it is not strictly mandated is the
  safer, simpler default.

**Why in code, not a DB table.** Issue #56 floats an admin-editable rules table.
That is deferred: a jurisdiction ruleset is security-sensitive policy that
should move through code review and carry a version stamp, and there is no admin
UI need yet. `RULE_VERSION` + this ADR give versioning and auditability now; a
DB-backed, admin-editable ruleset is a documented future extension that would
supersede this section, not a rewrite of the engine.

### 4. Privacy APIs under `/api/v1/privacy`

- `GET /privacy/consent` — read effective state so the widget can gate itself.
  Audit-side-effect-free: it writes no audit row and persists no consent record.
  It is not fully side-effect-free — a fresh signed subject cookie is set on the
  response when the request carries none (session establishment, not tracking).
- `POST /privacy/consent` — record a banner grant/deny.
- `POST /privacy/consent/withdraw` — deny all non-essential purposes.
- `POST /privacy/data-request` — data-subject export/delete. **Documented
  stub:** it audits and queues the request (returns a `requestId`) rather than
  performing erasure/export inline. Fulfilment is out-of-band and tracked
  separately.

### 5. Decision audit trail on `audit_logs`

Every decision emits the §19 event vocabulary as discrete audit rows —
`privacy.location_resolved` / `privacy.location_unknown` /
`privacy.geolocation_default_applied`, `privacy.rule_applied`,
`privacy.gpc_detected` / `privacy.gpc_applied`, and `privacy.consent_recorded` /
`privacy.consent_withdrawn` / `privacy.data_request` — carrying jurisdiction,
source, GPC, rule version, the resulting purposes, and a subject-key prefix.
Actor is the anonymous visitor (no `user_id`); the raw IP is not copied into the
audit metadata.

## Consequences

- The framework is extensible: adding a jurisdiction is a table row; adding a
  purpose is one enum entry plus a rules column; wiring a real geo source is
  supplying a `country`. None touch the decision logic.
- The engine is pure and exhaustively unit-tested (EU opt-in, US opt-out, GPC,
  unknown-strict); the APIs are integration-tested against real MySQL.
- Because geo is unresolved today, live traffic resolves to UNKNOWN → strict
  opt-in. That is deliberately conservative and will relax per-jurisdiction once
  a geo source lands.
- **Revisit** when (a) a geo/IP-country source is added, (b) any third-party tag
  is ever introduced — at which point the full banner/vendor machinery becomes
  mandatory — or (c) an admin-editable rules table is genuinely needed.
