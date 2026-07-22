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

# Retry the provisioning statement itself rather than probing first and acting
# after. On a fresh volume (CI) the entrypoint runs a temporary server during
# init: it answers `mysqladmin ping`, and even a root `SELECT 1`, then shuts
# down before the real server starts. So a probe that passes is no guarantee
# the *next* command finds a live socket — that window is how this failed with
# "ERROR 2002: Can't connect to local MySQL server through socket". Making the
# idempotent CREATE/GRANT the readiness check closes it.
echo "e2e: waiting for MySQL and provisioning ${DB_NAME}…"
deadline=$(( SECONDS + 120 ))
until docker exec livechat-mysql mysql -uroot "-p${ROOT_PASS}" -e \
  "CREATE DATABASE IF NOT EXISTS ${DB_NAME}; \
   GRANT ALL PRIVILEGES ON ${DB_NAME}.* TO '${DB_USER}'@'%'; FLUSH PRIVILEGES;" >/dev/null 2>&1; do
  if [ "$SECONDS" -ge "$deadline" ]; then
    echo "e2e: MySQL did not become ready within 120s" >&2
    docker logs --tail 50 livechat-mysql >&2 || true
    exit 1
  fi
  sleep 1
done

echo "e2e: seeding ${DB_NAME}…"
node_modules/.bin/tsx e2e/support/seed.ts

# Deterministic availability: start with no staff available so the journey
# suite controls it via real agent sockets (reconnecting agents re-add
# themselves). The widget's standalone happy-path specs have no agent socket,
# so they opt in via SEED_STAFF_AVAILABLE=1 to seed one placeholder — otherwise
# a visitor-initiated chat would (correctly) land in the no_support state.
docker exec livechat-redis redis-cli DEL presence:staff:available >/dev/null 2>&1 || true
if [ "${SEED_STAFF_AVAILABLE:-}" = "1" ]; then
  docker exec livechat-redis redis-cli SADD presence:staff:available e2e-seed-agent >/dev/null 2>&1 || true
fi

exec node_modules/.bin/tsx api/src/server.ts
