FROM node:22-alpine AS build
WORKDIR /app

COPY package.json package-lock.json ./
COPY api/package.json api/
COPY shared/package.json shared/
RUN npm ci --workspaces --include-workspace-root

COPY tsconfig.base.json ./
COPY shared ./shared
COPY api ./api

RUN npm --workspace @livechat/shared run build
RUN npm --workspace @livechat/api run build

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json ./
COPY api/package.json api/
COPY shared/package.json shared/
RUN npm ci --workspaces --include-workspace-root --omit=dev

COPY --from=build /app/shared/dist ./shared/dist
COPY --from=build /app/api/dist ./api/dist

EXPOSE 3000
CMD ["node", "api/dist/server.js"]
