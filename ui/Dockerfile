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
# `ui/tsconfig.json` includes `playwright.config.ts`, which imports the shared
# generated-spec config from the repo-root `e2e/support/` (#127). `tsc -b` runs
# as part of `npm run build`, so without this the ui image build fails on
# TS2307 — a break that has been latent on develop since #127 and only became
# visible once the build got past `npm ci` (#130). Build stage only: the
# runtime stage below copies just `ui/dist`, so nothing test-related ships.
COPY e2e ./e2e

RUN npm --workspace @livechat/ui run build

FROM nginx:1.27-alpine AS runtime
# Patch the base image's OS packages. `nginx:1.27-alpine` lags its Alpine
# base, and `trivy image` fails the CRITICAL gate on CVE-2026-31789 (OpenSSL
# heap overflow, libcrypto3/libssl3 3.3.3-r0 -> fixed in 3.3.7-r0) plus 33
# HIGHs. None are ours — they are all base-image OS packages — but an unpatched
# CRITICAL in a shipped image is a finding whoever it belongs to.
#
# `apk upgrade` rather than pinning a newer digest: the fix is already in the
# Alpine repo the base points at, so upgrading takes it without waiting for the
# nginx image to be rebuilt, and keeps working for the next advisory.
RUN apk upgrade --no-cache
RUN apk add --no-cache brotli
COPY ui/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/ui/dist /usr/share/nginx/html
EXPOSE 80

# Liveness probe (also satisfies CKV_DOCKER_2 / Trivy AVD-DS-0026). busybox
# wget ships in the nginx:1.27-alpine base, so no extra package is installed.
# Exec form (Hadolint DL3025); a non-zero wget exit marks it unhealthy.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD ["wget", "--quiet", "--output-document=/dev/null", "http://127.0.0.1:80/"]
