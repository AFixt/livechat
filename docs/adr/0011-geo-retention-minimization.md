# ADR-0011: Visitor geolocation minimization and retention-bound storage

- **Status:** Accepted
- **Date:** 2026-08-15
- **Deciders:** Engineering, AFixt (data controller)

## Context

The widget records a `visitor_sessions` row per site visitor carrying IP
address, coarse geo (country/city columns), current URL, referrer, user-agent
and an optional client identity-token subject. Until now these were stored
indefinitely — the model is soft-delete only, so nothing was ever actually
erased — and the planned geolocation feature (§3, `requirements.md`) had no
design describing what location data would be kept, at what granularity, or for
how long.

Storing precise IPs and city-level geo indefinitely is personal data held
without a defined purpose limit or retention period. Under GDPR/CCPA that is a
data-minimization (Art. 5(1)(c)) and storage-limitation (Art. 5(1)(e)) problem,
and it enlarges the blast radius of any breach. This ADR sets the storage model
for both today's fields and the planned geolocation feature. Issue #57.

## Decision

**Minimize at capture.** Before a visitor session is persisted, personal
network/location data is reduced to the coarsest form that still serves the
product purpose (abuse handling, geo routing, presence):

- **IP address** is truncated — the last octet of an IPv4 address and the last
  80 bits of an IPv6 address (retaining the `/48` network prefix) are zeroed.
  The full address is never written to the database. Implemented in
  `api/src/utils/pii-minimize.ts` (`truncateIp`) and applied in
  `visitor-session-service`.
- **Geolocation is country-level only.** City and region are dropped
  (`coarsenGeo`). The `city` column is retained in the schema for now but is
  always written `null`; the planned geo-IP lookup MUST feed its output through
  `coarsenGeo` so only a country code is stored. Latitude/longitude, postal
  code, and street-level data are **never** stored.

**What is kept vs dropped for the planned geolocation feature:**

| Signal | Stored? | Form |
| --- | --- | --- |
| Country | Yes | ISO country code/name |
| City / region | No | dropped at capture |
| Precise coordinates | No | never captured |
| Full IP | No | truncated `/24` (v4) or `/48` (v6) |
| Postal code | No | never captured |

**Retention-bound.** Every visitor session has a bounded lifetime controlled by
`VISITOR_DATA_RETENTION_DAYS` (default 90). A retention job
(`api/src/services/data-retention-service.ts`, run via
`api/src/scripts/purge-expired-visitor-data.ts`) purges sessions last seen
before the window:

- `anonymize` (default) — strips all PII columns (`ip_address`, `user_agent`,
  `country`, `city`, `current_url`, `referrer`, `identity_token_sub`), keeping
  the row so linked chat transcripts stay referentially intact.
- `delete` — hard-deletes the session; `ON DELETE CASCADE` removes its chats,
  messages and events too.

The job is idempotent and logs counts. It runs on real infrastructure's
scheduler — **not** a GitHub Actions cron (CLAUDE.md, "no scheduled GitHub
Actions").

**Lawful basis / rationale.** Country-level geo and truncated IP are retained on
the basis of legitimate interest in operating and securing the chat service
(routing, abuse mitigation, presence). The 90-day default is a defensible
operational window for support context; controllers can shorten it per tenant
policy via the env var. Minimizing at capture means even a full database
compromise never exposes a precise visitor location or a whole IP.

## Consequences

- Precise visitor location and full IPs never exist at rest — smaller breach
  blast radius and a straightforward data-subject/DPA story.
- Analytics that would need city-level geo or full IPs are foreclosed by design;
  reintroducing them requires revisiting this ADR and the lawful basis.
- The `anonymize` default keeps chat history readable for support/audit after a
  visitor's PII is gone; operators wanting full erasure set the `delete`
  strategy.
- A scheduled runner outside GitHub Actions must invoke the purge script; if it
  is never scheduled, data is minimized at capture but not aged out.

## Alternatives considered

- **Store full IP + city, delete on a timer only** — rejected: leaves precise
  personal data at rest for up to the whole window and in every backup taken
  during it. Minimizing at capture is strictly stronger.
- **Hash the IP instead of truncating** — rejected: a salted hash is still a
  stable per-visitor identifier (re-identifiable by brute-forcing the small
  IPv4 space) and loses the network-prefix utility truncation keeps.
- **No retention job, rely on paranoid soft-delete** — rejected: soft-delete
  never erases anything; it was the original defect.

## Links

- requirements.md §3 (visitor identity / geolocation)
- `docs/privacy/data-retention.md`
- `api/src/utils/pii-minimize.ts`, `api/src/services/data-retention-service.ts`
- GitHub issue #57
