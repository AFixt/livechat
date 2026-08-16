# ADR-0017: Defer chat attachments; make S3 configuration optional

- **Status:** Accepted
- **Date:** 2026-08-16
- **Deciders:** Karl Groves

## Context

Chat attachments were wired at the persistence layer but nowhere else. The
`chat_attachments` table (`20260424000012-create-chat-attachments.cjs`), the
`ChatAttachment` model, and its associations existed, and `env.ts` made
`S3_ACCESS_KEY`, `S3_SECRET_KEY`, and `S3_BUCKET` **required at boot** — the API
would not start without them. Yet there was no upload route, no download route,
no UI, and no `@aws-sdk` usage anywhere in `api/src`. Every deployment had to
supply real S3 credentials for a feature that does not exist (issue #80, part
1).

Building attachments properly means the full `secure-project-baseline` §10.5
upload-control surface (extension allowlist, server-side MIME + magic-byte
checks, size cap, SVG rejected or sanitised, isolated bucket, presigned-URL-only
reads). That is a scheduled feature, not something to carry half-built.

## Decision

1. **Defer attachments** rather than build the S3 feature now.
2. **Drop `chat_attachments`** via a reversible migration
   (`20260814000001-drop-chat-attachments.cjs`) whose `down` recreates the table
   (mirroring the original create) so the feature can be reinstated cleanly.
3. **Remove the `ChatAttachment` model and its associations.**
4. **Make `S3_ACCESS_KEY` / `S3_SECRET_KEY` / `S3_BUCKET` optional**
   (`default: ''`) so no deployment needs credentials for an absent feature.
   Make them required again when attachments are built.

## Consequences

- Fresh deployments boot with no S3 configuration; `.env.production.example`
  documents the vars as optional-until-attachments-ship.
- The schema/model drift and parity guards stay green — the model and the
  migrated schema are both attachment-free.
- Reinstating the feature is a migration `down` (or a fresh create) plus
  restoring the model; the schema shape is preserved in the drop migration.
- Local dev (`docker-compose` MinIO) and the DigitalOcean manifest still
  provision S3; those become inert until the feature returns and can be pruned
  as a follow-up.

## Alternatives considered

- **Build attachments now** — rejected: the full §10.5 upload-control surface is
  a scheduled feature; shipping it under a cleanup PR would be unreviewable
  scope.
- **Leave the schema and secrets in place** — rejected: it forces real S3
  credentials on every deployment for a feature that does not exist, and leaves
  dead schema/model to maintain.

## Links

- Issue #80 (part 1 — attachments)
- requirements.md §4.6 (sensitive data), secure-project-baseline §10.5
- `api/src/db/migrations/20260814000001-drop-chat-attachments.cjs`
