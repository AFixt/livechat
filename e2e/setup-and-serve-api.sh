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

echo "e2e: waiting for MySQL…"
until docker exec livechat-mysql mysqladmin ping -h localhost --silent >/dev/null 2>&1; do
  sleep 1
done

docker exec livechat-mysql mysql -uroot "-p${ROOT_PASS}" -e \
  "CREATE DATABASE IF NOT EXISTS ${DB_NAME}; \
   GRANT ALL PRIVILEGES ON ${DB_NAME}.* TO '${DB_USER}'@'%'; FLUSH PRIVILEGES;"

echo "e2e: seeding ${DB_NAME}…"
node_modules/.bin/tsx e2e/support/seed.ts

# Deterministic availability: reconnecting agent sockets re-add themselves.
docker exec livechat-redis redis-cli DEL presence:staff:available >/dev/null 2>&1 || true

exec node_modules/.bin/tsx api/src/server.ts
