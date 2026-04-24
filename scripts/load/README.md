# Load tests

REST-layer load scenarios for the livechat API. Run with Artillery against a
locally-running stack — they're not hooked into CI.

## Setup

```bash
docker compose up -d mysql redis
npm --workspace api run migrate
npx tsx api/scripts/seed-dev.mjs   # creates tenant 'acme' and an admin user
npm --workspace api run dev &      # api listens on :23001
```

## Run a scenario

```bash
npm run load                       # visitor-burst.yml (default)
npx artillery run scripts/load/visitor-burst.yml --output load-report.json
npx artillery report load-report.json
```

## Targets from the plan

- **1,000 concurrent visitors per tenant** — raise `arrivalRate` in `Sustained`
  phase; each VU makes ~3 requests.
- **p95 message delivery < 500ms** — inspect the Artillery summary's
  `p95.http.response_time` for the `/visitor/chats` endpoint.

## Why Artillery (not k6)?

Artillery's YAML is easier to diff in PR review than k6's JS scenarios, and the
plan didn't pick one. Switch if the team ever needs k6's distributed mode — the
scenario is small enough to port in an afternoon.

## Socket.IO load?

Not here yet. Socket.IO load testing needs a custom engine (e.g.
`artillery-engine-socketio-v3`) or k6's `xk6-socketio` extension. Track as a
phase-10 follow-up if the REST scenario surfaces no regressions.
