#!/usr/bin/env bash
#
# The api webServer entry for the e2e stack. Playwright starts webServers
# before globalSetup, so this brings up the shared infra, creates and seeds
# the dedicated database, then execs the api — guaranteeing the schema and
# fixtures exist before the server (or the ui/widget that proxy to it) accept
# a request. Env (DB_NAME, ports, secrets) comes from the Playwright config.
set -euo pipefail

cd "$(dirname "$0")/.."

ROOT_PASS="${DB_ROOT_PASS:-livechat_root_pass}"

docker compose up -d mysql redis mailhog

# On a fresh volume (CI) the entrypoint runs a *temporary* server during init.
# It answers `mysqladmin ping`, a root `SELECT 1`, and even `CREATE DATABASE` —
# then shuts down before the real server starts, killing any connection opened
# in that window (`PROTOCOL_CONNECTION_LOST`). Retrying a single statement is
# not sufficient, because the statement can succeed against the temporary
# server; the init phase has to be observed to completion first. The image logs
# "Temporary server started" on entry and "MySQL init process done" on exit, so
# wait for the latter whenever the former appears. An existing volume logs
# neither and falls straight through to the connectivity check.
mysql_ready() {
  local logs
  logs=$(docker logs livechat-mysql 2>&1 || true)
  if grep -q 'Temporary server started' <<<"$logs" \
    && ! grep -q 'MySQL init process done' <<<"$logs"; then
    return 1
  fi
  docker exec livechat-mysql mysql -uroot "-p${ROOT_PASS}" -e 'SELECT 1' >/dev/null 2>&1
}

echo "e2e: waiting for MySQL…"
deadline=$(( SECONDS + 180 ))
until mysql_ready; do
  if [ "$SECONDS" -ge "$deadline" ]; then
    echo "e2e: MySQL did not become ready within 180s" >&2
    docker logs --tail 50 livechat-mysql >&2 || true
    exit 1
  fi
  sleep 1
done

echo "e2e: provisioning ${DB_NAME}…"
docker exec livechat-mysql mysql -uroot "-p${ROOT_PASS}" -e \
  "CREATE DATABASE IF NOT EXISTS ${DB_NAME}; \
   GRANT ALL PRIVILEGES ON ${DB_NAME}.* TO '${DB_USER}'@'%'; FLUSH PRIVILEGES;"

# Belt and braces: the seed drops every table and replays the migrations, so it
# is safe to repeat, and a connection dropped mid-migration should not fail the
# whole run.
echo "e2e: seeding ${DB_NAME}…"
seed_attempt=1
until node_modules/.bin/tsx e2e/support/seed.ts; do
  if [ "$seed_attempt" -ge 3 ]; then
    echo "e2e: seeding failed after ${seed_attempt} attempts" >&2
    exit 1
  fi
  echo "e2e: seed attempt ${seed_attempt} failed; retrying…" >&2
  seed_attempt=$(( seed_attempt + 1 ))
  sleep 3
done

# Deterministic availability: start with no staff available so the journey
# suite controls it via real agent sockets (reconnecting agents re-add
# themselves). The widget's standalone happy-path specs have no agent socket,
# so they opt in via SEED_STAFF_AVAILABLE=1 to seed one placeholder — otherwise
# a visitor-initiated chat would (correctly) land in the no_support state.
# The keys are tenant- and user-scoped (see presence-service.ts):
#   presence:staff:available:<tenantId>   set of explicitly-available user ids
#   presence:staff:conn:<userId>          connection-liveness marker, TTL 120s
# `anyStaffAvailable` unions the tenant + global sets and then drops any member
# with no live conn key, so a seeded placeholder needs BOTH.
for k in $(docker exec livechat-redis redis-cli --scan --pattern 'presence:staff:available:*'); do
  docker exec livechat-redis redis-cli DEL "$k" >/dev/null 2>&1 || true
done
for k in $(docker exec livechat-redis redis-cli --scan --pattern 'presence:staff:status:*'); do
  docker exec livechat-redis redis-cli DEL "$k" >/dev/null 2>&1 || true
done
if [ "${SEED_STAFF_AVAILABLE:-}" = "1" ]; then
  seed_tenant=$(docker exec livechat-mysql mysql -N -B -uroot "-p${ROOT_PASS}" \
    -e "SELECT id FROM tenants WHERE slug='acme' LIMIT 1;" "${DB_NAME}" 2>/dev/null | tr -d '\r')
  if [ -z "$seed_tenant" ]; then
    echo "e2e: SEED_STAFF_AVAILABLE=1 but the acme tenant was not found in ${DB_NAME}" >&2
    exit 1
  fi
  docker exec livechat-redis redis-cli SADD "presence:staff:available:${seed_tenant}" e2e-seed-agent >/dev/null
  docker exec livechat-redis redis-cli SET presence:staff:conn:e2e-seed-agent 1 EX 3600 >/dev/null
  echo "e2e: seeded a placeholder available agent for tenant ${seed_tenant}"
fi

exec node_modules/.bin/tsx api/src/server.ts
