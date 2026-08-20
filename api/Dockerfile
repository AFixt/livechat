FROM node:22-alpine AS deps
WORKDIR /app

COPY package.json package-lock.json ./
COPY api/package.json api/
COPY shared/package.json shared/
RUN npm ci --workspaces --include-workspace-root --omit=dev --engine-strict=false \
    # npm hoists workspace dependencies to the root `node_modules`, so a
    # workspace may legitimately end up with no `node_modules` of its own.
    # The runtime stage copies these paths unconditionally, and `COPY` fails
    # on a missing source — create them so the build does not depend on
    # which packages happened to hoist.
    && mkdir -p shared/node_modules api/node_modules

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production

# Production deps only (tsx + sequelize-cli are declared as regular deps
# so migrations and runtime both work without a separate build stage).
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/shared/node_modules ./shared/node_modules
COPY --from=deps /app/api/node_modules ./api/node_modules

# Source is the production artifact — tsx transpiles on demand. Keeps the
# build pipeline minimal; cost is ~1–2s startup, amortized over the
# container's lifetime.
COPY package.json package-lock.json ./
COPY tsconfig.base.json ./
COPY api/package.json api/
COPY api/tsconfig.json api/
COPY api/.sequelizerc api/
COPY api/src api/src
COPY shared/package.json shared/
COPY shared/src shared/src

# Remove npm and corepack from the runtime image (#132). The base image's
# bundled npm carries its own vendored dependency tree, which is where every
# vulnerability `trivy image` reports against this image comes from — a
# CRITICAL in `tar` (CVE-2026-59873) plus seven HIGHs in `brace-expansion`,
# `ip-address`, `picomatch` and `sigstore`. None are ours: `tar` does not
# appear in package-lock.json at all.
#
# Nothing in the running container needs a package manager — the dependencies
# are already installed and copied in, and `tsx` / `sequelize-cli` are invoked
# from node_modules/.bin directly (see CMD below, .do/app.yaml jobs, and the
# migrate service in docker-compose.prod.yml). Deleting rather than upgrading
# removes the whole class of finding instead of resetting its clock.
#
# yarn goes too. The base image ships it at /opt/yarn-* with its own vendored
# tree; it scans clean today, but it is the same shape of risk and nothing here
# uses it. Removing every package manager means a future advisory in any of
# their bundled dependencies cannot reach this image at all.
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack \
    /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack \
    /opt/yarn-* /usr/local/bin/yarn /usr/local/bin/yarnpkg

# Drop to the unprivileged user the node images ship with. Everything above
# is copied read-only, so no chown is needed.
USER node

# The api workspace is the working directory, because that is the cwd
# `npm --workspace @livechat/api` established and some config is resolved
# against it — notably api/.sequelizerc, which does `path.resolve('src', ...)`.
# Keeping it identical means the migrate job and any `docker exec` behave as
# before, now that the npm indirection is gone.
WORKDIR /app/api

EXPOSE 3000

# Liveness probe for the container runtime (and the CKV_DOCKER_2 / Trivy
# AVD-DS-0026 "no HEALTHCHECK" checks). Hits the same /api/v1/health path the
# DigitalOcean App Platform spec (.do/app.yaml) uses. busybox wget ships in the
# node:22-alpine base, so no extra package is installed. Exec form (Hadolint
# DL3025) — a non-zero wget exit already marks the container unhealthy, so no
# shell `|| exit 1` is needed.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD ["wget", "--quiet", "--output-document=/dev/null", "http://127.0.0.1:3000/api/v1/health"]

# Exec `tsx` directly rather than via `npm run start` (#132) — same command the
# `start` script runs, one fewer process, and no package manager in the image.
CMD ["/app/node_modules/.bin/tsx", "src/server.ts"]
