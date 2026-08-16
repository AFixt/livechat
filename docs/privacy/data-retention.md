# Visitor data retention & minimization

How AFixt LiveChat limits and ages out the personal data it captures about site
visitors. Design rationale and the geolocation record model live in
[ADR-0020](../adr/0020-geo-retention-minimization.md). Issue #57.

## What is captured

A `visitor_sessions` row is created when the widget boots on a client site. It
can hold: a truncated IP address, country, language, current URL, referrer,
user-agent, and — when the client passes an identity token — the token's
subject claim. It is **not** a user account; there is no name, email or
password.

## Minimization at capture

Personal network/location data is reduced **before it is persisted** by
`api/src/utils/pii-minimize.ts`:

- **IP truncation** — the last octet of an IPv4 address (`203.0.113.42` →
  `203.0.113.0`) and the last 80 bits of an IPv6 address
  (`2001:db8:85a3:…` → `2001:db8:85a3::`, the `/48` prefix) are zeroed. The full
  address is never written to the database.
- **Country-level geo only** — city and region are dropped; precise coordinates
  and postal codes are never captured. The planned geo-IP lookup must feed its
  result through `coarsenGeo` so only a country is stored.

## Retention window

Every session has a bounded lifetime, measured from `last_seen_at`:

| Setting | Default | Meaning |
| --- | --- | --- |
| `VISITOR_DATA_RETENTION_DAYS` | `90` | Days after last activity before a session is purged. |
| `VISITOR_DATA_RETENTION_STRATEGY` | `anonymize` | `anonymize` strips PII and keeps the row; `delete` hard-deletes it. |

Controllers can shorten the window or switch to `delete` per deployment policy.

## The retention job

`api/src/services/data-retention-service.ts` implements `purgeExpiredVisitorData`;
`api/src/scripts/purge-expired-visitor-data.ts` runs it from env.

- **`anonymize`** (default) clears `ip_address`, `user_agent`, `country`,
  `city`, `current_url`, `referrer` and `identity_token_sub`, leaving the row so
  linked chat transcripts stay intact.
- **`delete`** hard-deletes the session; `ON DELETE CASCADE` removes its chats,
  messages and events too.

The job is **idempotent** — a second run over the same window finds nothing left
to anonymize — and logs the cutoff and the count of rows affected.

### Running it

```sh
# from api/
VISITOR_DATA_RETENTION_DAYS=90 \
VISITOR_DATA_RETENTION_STRATEGY=anonymize \
  tsx src/scripts/purge-expired-visitor-data.ts
```

Schedule it on real infrastructure (a platform cron / scheduled job with its own
alerting and retries). Per the repository's CI policy it must **not** be run
from a GitHub Actions `schedule:` trigger.

## Data-subject requests

To erase a specific visitor ahead of the window, delete their
`visitor_sessions` row directly (cascades to their chats), or run the job with a
short `VISITOR_DATA_RETENTION_DAYS`. Because IPs are truncated and geo is
country-level, stored data cannot single out an individual device or precise
location on its own.
