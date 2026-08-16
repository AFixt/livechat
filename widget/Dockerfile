FROM node:22-alpine AS build
WORKDIR /app

COPY package.json package-lock.json ./
COPY widget/package.json widget/
COPY shared/package.json shared/
RUN npm ci --workspaces --include-workspace-root --engine-strict=false

COPY tsconfig.base.json ./
COPY shared ./shared
COPY widget ./widget

RUN npm --workspace @livechat/widget run build

FROM nginx:1.27-alpine AS runtime
COPY widget/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/widget/dist /usr/share/nginx/html
COPY widget/index.html /usr/share/nginx/html/index.html
EXPOSE 80

# Liveness probe (also satisfies CKV_DOCKER_2 / Trivy AVD-DS-0026). busybox
# wget ships in the nginx:1.27-alpine base, so no extra package is installed.
# Exec form (Hadolint DL3025); a non-zero wget exit marks it unhealthy.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD ["wget", "--quiet", "--output-document=/dev/null", "http://127.0.0.1:80/"]
