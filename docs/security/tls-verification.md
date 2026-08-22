# TLS / HTTPS verification

`scripts/check-tls.sh` (npm: `npm run security:tls`) verifies the transport
security of a **deployed** environment. It is part of the security-baseline
program (issues #59-65, #82-84) and covers the "is HTTPS actually configured
correctly in production?" gap that no local test can answer.

## Why it is deployed-only

There is no TLS to inspect on a local dev box or inside a PR sandbox — the app
runs plain HTTP behind a terminating proxy there. So the harness is a **no-op
that exits 0 when no target is configured**. That is deliberate: `security:tls`
is wired into the aggregate `npm run security` run, and a no-target no-op keeps
local pre-push and PR runs from failing spuriously. It only does real work when
you point it at a URL.

## How to run it

Point it at staging or production with `TLS_TARGET_URL` (or pass the host/URL as
the first argument):

```bash
# against production
TLS_TARGET_URL=https://api.livechat.afixt.com npm run security:tls

# or directly, passing the target as an argument
bash scripts/check-tls.sh https://console.livechat.afixt.com
```

The app deploys to DigitalOcean App Platform (see `docs/deploy.md` and
`.do/app.yaml`) across three hosts — run it against each once a public URL
exists:

- `api.*` — the Express + Socket.IO service
- `console.*` — the support/admin console static site
- `widget.*` — the customer widget static site

In CI, set `TLS_TARGET_URL` as a repo/environment variable (mirroring the
existing `ZAP_TARGET_URL` pattern) so the job runs against the deployed URL and
gates the pipeline. The script exits non-zero on any failed check.

### Tunables

- `TLS_HSTS_MIN_AGE` — minimum acceptable HSTS `max-age` in seconds. Default
  `15552000` (180 days), the floor `hstspreload.org` requires for preload
  eligibility.
- `TESTSSL_SEVERITY` — the severity testssl.sh records/prints. Default `HIGH`.
  The gate fails on any `HIGH`/`CRITICAL` finding.

## What each check means

The script runs four independent checks and exits non-zero if any fail.

### 1. testssl.sh — deep TLS audit

Runs [testssl.sh](https://github.com/testssl/testssl.sh) against the origin to
audit protocol versions, cipher suites, certificate chain, and known TLS CVEs
(Heartbleed, ROBOT, BEAST, etc.). It is **not vendored** — the script invokes
`testssl.sh` (or `testssl`) if it is on `PATH`, and otherwise prints a clear
skip plus an install hint. This mirrors `scripts/semgrep.sh`: external tools are
a soft dependency, and their absence degrades to a skip rather than breaking the
run.

Install it locally with `brew install testssl`, or clone the repo and put
`testssl.sh` on your `PATH`.

The gate uses testssl's `--jsonfile` output (not its exit code, which does not
reliably reflect findings) and fails if any finding is tagged `HIGH` or
`CRITICAL`.

### 2. HTTP -> HTTPS redirect

Requests the `http://` origin and requires a **permanent** `301` or `308`
redirect to an `https://` location. A temporary `302`/`307` to HTTPS is reported
as a failure — permanent redirects are what let browsers and HSTS preload treat
the site as HTTPS-only. No redirect at all is a failure.

### 3. HSTS (Strict-Transport-Security)

Requires the `Strict-Transport-Security` header on the HTTPS response, with:

- a `max-age` at or above `TLS_HSTS_MIN_AGE` (default 180 days), and
- `includeSubDomains`.

HSTS tells the browser to refuse plain-HTTP connections to the host for
`max-age` seconds, closing the SSL-stripping window after the first visit.

### 4. Secure cookie flags

For every `Set-Cookie` the origin emits, requires `Secure`, `HttpOnly`, and
`SameSite`. If the origin sets no cookies, the check is skipped (nothing to
verify). This catches session or CSRF cookies that would otherwise leak over
plain HTTP, be readable from JavaScript, or ride cross-site requests.

## Reading testssl.sh output

testssl.sh prints a colorized, sectioned report to the console (protocols,
cipher categories, vulnerabilities, certificate info). Each finding carries a
severity — `INFO`, `LOW`, `MEDIUM`, `HIGH`, `CRITICAL`. When reviewing:

- Anything `HIGH`/`CRITICAL` fails the gate and must be fixed at the terminating
  proxy / platform TLS config — it is never something the app code can change.
- `MEDIUM` and below are informational here; review them, but they do not block.
- The full machine-readable result is written to the temp JSON file named in the
  script's output for that run, so you can diff or archive it.

Because TLS termination is owned by DigitalOcean App Platform (or the upstream
proxy in the self-hosted compose path, per `docs/deploy.md`), remediation for
protocol/cipher findings happens in the platform's TLS settings, not in this
repo.
