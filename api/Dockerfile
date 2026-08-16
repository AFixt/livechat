FROM node:22-alpine AS deps
WORKDIR /app

COPY package.json package-lock.json ./
COPY api/package.json api/
COPY shared/package.json shared/
RUN npm ci --workspaces --include-workspace-root --omit=dev --engine-strict=false

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

# Drop to the unprivileged user the node images ship with. Everything above
# is copied read-only, so no chown is needed.
USER node

EXPOSE 3000

# Liveness probe for the container runtime (and the CKV_DOCKER_2 / Trivy
# AVD-DS-0026 "no HEALTHCHECK" checks). Hits the same /api/v1/health path the
# DigitalOcean App Platform spec (.do/app.yaml) uses. busybox wget ships in the
# node:22-alpine base, so no extra package is installed. Exec form (Hadolint
# DL3025) — a non-zero wget exit already marks the container unhealthy, so no
# shell `|| exit 1` is needed.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD ["wget", "--quiet", "--output-document=/dev/null", "http://127.0.0.1:3000/api/v1/health"]

CMD ["npm", "--workspace", "@livechat/api", "run", "start"]
