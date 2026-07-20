# Deploy runbook

Two supported targets: **DigitalOcean App Platform** (primary — tracked in
`.do/app.yaml`) and **self-hosted Docker Compose** (alternative —
`docker-compose.prod.yml`). Pick one.

This runbook assumes:

- DNS you control at `api.*`, `console.*`, and `widget.*` (the subdomains are
  all in `.do/app.yaml`; swap to your own domain by editing the PR that adopts
  this file).
- `doctl` configured locally with a PAT that has `read,write` on the apps +
  databases scopes.
- An S3-compatible bucket + credentials for chat attachments.
- An SMTP relay for outgoing mail.

## DigitalOcean App Platform (primary)

### First deploy

```bash
# 1. Install doctl and auth
brew install doctl
doctl auth init

# 2. Create the app from the committed spec
doctl apps create --spec .do/app.yaml

# 3. Set every SECRET-typed env var. App Platform prompts for empty
#    ones; set them via the UI OR with doctl:
doctl apps update <APP_ID> --spec .do/app.yaml
# Then in the UI: Settings → App-level env → reveal each SECRET row
# and paste values from your password manager.

# 4. Trigger the initial deploy. The `migrate` PRE_DEPLOY job applies
#    every Sequelize migration before the api service starts accepting
#    traffic.
doctl apps create-deployment <APP_ID>

# 5. One-off: seed the first tenant. In .do/app.yaml, flip the
#    seed-first-tenant job to `instance_count: 1`, commit, push, and
#    re-deploy. After the deploy shows the job succeeded, flip it back
#    to `instance_count: 0` in a follow-up PR so subsequent deploys
#    don't re-run it.

# 6. Verify
curl -s https://api.livechat.afixt.com/api/v1/health
```

### Every subsequent deploy

Pushing to `main` (or a manually-run deploy) rebuilds the three containers and
the PRE_DEPLOY `migrate` job runs any new migrations before new traffic lands.
No manual steps.

### Rollback

```bash
doctl apps list-deployments <APP_ID>
doctl apps create-deployment <APP_ID> --force-rebuild=false \
  --git-commit-hash <PREVIOUS_SHA>
```

Any migration that was applied by the bad deploy stays applied — Sequelize
migrations are assumed forward-compatible. For a schema revert, run
`npm --workspace @livechat/api run migrate:undo` against the managed DB
manually. Plan migrations so rollback-from-the-next- commit is safe even without
an undo.

### Backups

DigitalOcean's managed MySQL does automated daily backups with 7-day retention
by default. Upgrade to the `production` plan (set in `.do/app.yaml`) to get that
cadence. Point-in-time restore is also available. Redis is ephemeral — session +
rate-limit state is reconstructible.

### Observability

- **Logs**: `doctl apps logs <APP_ID> --component api --follow`. Pino emits JSON
  to stdout; App Platform preserves the structure.
- **Metrics**: App Platform's dashboard shows CPU / memory / request rate per
  service. Alerts via App Platform's native UI.
- **Lighthouse CI**: runs on every PR via `.github/workflows/lhci.yml`.
- **OWASP ZAP baseline**: weekly against `ZAP_TARGET_URL` (configure as a repo
  variable once a public URL exists).

### Scaling

- **api**: bump `instance_count` in `.do/app.yaml` (currently 2). Redis is
  shared — rate-limit counters and Socket.IO adapter state both live there, so
  horizontal scaling is safe. Socket.IO needs a Redis adapter when > 1 instance;
  confirm before flipping to 3+.
- **Managed MySQL**: resize via the DO UI. No app changes.
- **widget + ui**: static sites; App Platform serves them through its CDN. No
  scaling knobs.

## Self-hosted Docker Compose (alternative)

```bash
cp .env.production.example .env.production
vim .env.production            # fill in every blank value
docker compose -f docker-compose.prod.yml --env-file .env.production up -d
```

The compose file runs a one-shot `migrate` service that completes before the
`api` service starts. Behind the scenes:

- MySQL 8 + Redis 7 + api + ui + widget in one stack.
- TLS terminated upstream (put Caddy, Traefik, or Cloudflare Tunnel in front on
  ports 8080 / 8081 / 3000).
- Backups are your responsibility —
  `docker compose exec mysql mysqldump -u root -p$MYSQL_ROOT_PASSWORD livechat > backup.sql`
  on a cron, ship off-host.

## First tenant: AFixt itself

Once the stack is live and the `seed-first-tenant` job has run (supplying
`FIRST_ADMIN_EMAIL` + `FIRST_ADMIN_PASSWORD` via secret env), the initial
`super_admin` can log in at `https://console.livechat.afixt.com/login`. From
there:

1. `/admin/tenants` — confirm the `afixt` tenant exists.
2. Set allowed origins to the AFixt marketing site domain(s).
3. Drop the embed snippet into the marketing-site template.
4. Log out, visit `https://afixt.com`, open the widget, send a test message —
   confirm the super_admin dashboard shows the visitor in real-time.

That's the complete dog-food loop.

## Incident checklist

If production is on fire, in this order:

1. `doctl apps logs <APP_ID> --component api --follow` — look for FATAL.
2. Check managed DB + Redis health in the DO UI.
3. Consider a rollback (see above) — generally preferable to debugging live.
4. If the widget is returning 500s and chats are stuck: disable new visitor
   sessions with a tenant flip (`status: suspended`) via the admin console.
   Existing active chats keep working.
5. Post-mortem lives in `docs/incidents/<date>.md`.
