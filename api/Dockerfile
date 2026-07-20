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
CMD ["npm", "--workspace", "@livechat/api", "run", "start"]
