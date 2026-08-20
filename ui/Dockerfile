# syntax=docker/dockerfile:1
FROM node:22-alpine AS build
WORKDIR /app

COPY package.json package-lock.json ./
COPY ui/package.json ui/
COPY shared/package.json shared/
# The workspace devDependencies this build needs (vite, typescript) sit
# alongside private `@afixt/*` packages — `@afixt/a11y-assert` is a direct
# devDependency of the ui workspace, and it pulls `@afixt/test-utils` — so
# `npm ci` has to authenticate (#130). The token is mounted as a BuildKit
# secret rather than passed as a build arg, so it never lands in a layer or in
# `docker history`. `required=false` keeps the build usable without one: it
# then fails on the 404 exactly as before rather than erroring on a missing
# secret. scripts/trivy-image.sh passes --secret; see also the trivy-image job
# in .github/workflows/container-iac-scan.yml.
RUN --mount=type=secret,id=npmrc,target=/root/.npmrc,required=false \
    npm ci --workspaces --include-workspace-root --engine-strict=false

COPY tsconfig.base.json ./
COPY shared ./shared
COPY ui ./ui

RUN npm --workspace @livechat/ui run build

FROM nginx:1.27-alpine AS runtime
RUN apk add --no-cache brotli
COPY ui/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/ui/dist /usr/share/nginx/html
EXPOSE 80

# Liveness probe (also satisfies CKV_DOCKER_2 / Trivy AVD-DS-0026). busybox
# wget ships in the nginx:1.27-alpine base, so no extra package is installed.
# Exec form (Hadolint DL3025); a non-zero wget exit marks it unhealthy.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD ["wget", "--quiet", "--output-document=/dev/null", "http://127.0.0.1:80/"]
