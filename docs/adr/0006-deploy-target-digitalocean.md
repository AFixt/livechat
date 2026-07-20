# ADR-0006: Deploy to DigitalOcean App Platform as the primary target

- **Status:** Accepted
- **Date:** 2026-04-24
- **Deciders:** Karl Groves

## Context

Phase 10 of the livechat plan calls for a production deploy spec + the "first
tenant" onboarding (AFixt itself). The plan flagged DO App Platform as the
default based on help-desk's `.do/` folder, but left the decision open. This ADR
locks in the target, the secrets model, the backup cadence, and the rollback
path.

AFixt is a small, pre-revenue company. The priorities, in order:

1. **Low ops burden.** No full-time SRE; deploys and backups have to be
   somebody-else's-problem.
2. **Predictable cost.** No surprise bills; clear cap on infra spend.
3. **Reasonable scalability.** Needs to handle the plan's p95 target (500 ms
   message delivery, 1k visitors + 50 staff per tenant) out of the gate. Doesn't
   need to survive a Superbowl ad.
4. **Portable.** If DO becomes the wrong choice later, the code shouldn't care.

## Decision

Deploy to **DigitalOcean App Platform** with managed MySQL and managed Redis.
Everything is spec'd in `.do/app.yaml`, which is the source of truth.

### Application topology

- **api** service (2 × `basic-xxs`) — Express + Socket.IO, behind App Platform's
  load balancer. Scale horizontally by bumping `instance_count` in the spec.
- **ui** static site — support console SPA; CDN-served.
- **widget** static site on its own subdomain — the embed contract
  (requirements.md §6.2) requires cross-origin loading.
- **db** managed MySQL 8 production plan (daily automated backups, 7-day
  retention, point-in-time restore available).
- **redis** managed Redis 7 (ephemeral — no critical state).

### Jobs

- `migrate` — `PRE_DEPLOY`, runs `sequelize-cli db:migrate` before new code
  receives traffic.
- `seed-first-tenant` — `POST_DEPLOY`, `instance_count: 0` by default. Flip to 1
  in a PR for the one-time seed, flip back after verifying.

### Secrets model

- Every secret (`DB_PASS`, `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`,
  `COOKIE_SECRET`, `S3_*` keys, `SMTP` creds, `FIRST_ADMIN_*`) declared with
  `type: SECRET` in `.do/app.yaml` with an empty `value`. Real values live only
  in App Platform's secret store, set manually via the UI or `doctl`.
- Rotate secrets by setting a new value in the UI and triggering a redeploy.
  `rotateEmbedSecret` endpoint handles per-tenant embed secrets — no redeploy
  needed.

### Runtime choice

We run the API via `tsx` at startup, not a pre-compiled `dist/`. Cost: ~1–2 s
additional boot time. Benefit: eliminates an entire class of monorepo-build
friction (tsconfig project references, module resolution between
`@livechat/shared` and `api` at compile time vs. runtime, emitting `.js` files
for `.cjs` migration scripts). The pre-push `npm run check` still runs the full
TypeScript compiler via `tsc --noEmit`, so type safety is enforced the same way.

If API startup time ever actually matters, swap to `tsup` bundle in a follow-up
ADR.

## Consequences

**Easier:**

- A greenfield deploy is six `doctl` commands.
- Managed MySQL backups + rollback path are built-in.
- Log aggregation + dashboards come with the platform.
- Horizontal API scaling is one YAML field.
- Self-hosted fallback (`docker-compose.prod.yml` + `.env.production`) is
  maintained in parallel for sovereignty-minded tenants.

**Harder:**

- DO outages become livechat outages. Mitigation: the stack can be redeployed to
  Fly.io / Render / Railway with modest spec changes (the
  `docker-compose.prod.yml` path is the starting point for any re-platforming).
- Managed Redis doesn't cluster on the basic plan — single point of failure for
  rate-limit counters + Socket.IO adapter. Upgrade to the production plan once
  we have paying tenants.

## Alternatives considered

- **Fly.io** — viable, slightly more flexible around custom regions, but adds
  Fly-specific secrets (`FLY_API_TOKEN`, per-VM private networking). DO's UX is
  simpler and the team already has a DO account for help-desk.
- **Kubernetes (DO Kubernetes, EKS, GKE)** — rejected. Pre-revenue, no SRE. The
  ops cost dwarfs the benefit for a single small product.
- **Render** — nearly identical to DO App Platform in capability. DO chosen for
  parity with the existing AFixt infrastructure.
- **Pre-compile TypeScript to dist/** — considered, then rejected in favor of
  `tsx` runtime (see "Runtime choice" above). Revisit if startup latency becomes
  a real cost.

## Links

- `.do/app.yaml`
- `docker-compose.prod.yml`
- `.env.production.example`
- `docs/deploy.md`
- requirements.md §6.1 (hosting & deployment)
