# API security testing

The OpenAPI document at `/api/docs` is the contract for the REST API. This page
covers the three things we do with it beyond serving Swagger UI:

1. **Property-based fuzzing** with
   [Schemathesis](https://schemathesis.readthedocs.io/).
2. **An active DAST scan** with the OWASP ZAP **API scan** (OpenAPI-driven),
   kept separate from the passive baseline scan.
3. **Spec security validation** — a unit test asserting the document declares
   its auth schemes and that non-public operations require them.

All three are driven from the same generated spec, so they test what we actually
ship rather than a hand-maintained copy.

> Issue [#62](https://github.com/AFixt/livechat/issues/62).

## Generating the spec

`api/src/scripts/generate-openapi.ts` serializes the live OpenAPI document to a
file (or stdout) **without booting the API** — it imports the route barrel so
every route's `openApiRegistry.registerPath(...)` side effect runs, then calls
`buildOpenApiSpec`. No MySQL/Redis and no full env are needed; only `API_URL` is
read (for the `servers[0].url`), defaulting to `http://localhost:3000`.

```bash
# to a file
node_modules/.bin/tsx api/src/scripts/generate-openapi.ts openapi.json

# to stdout, with an explicit server URL
API_URL=https://staging-api.afixt.com \
  node_modules/.bin/tsx api/src/scripts/generate-openapi.ts -
```

The generated `servers[0].url` is `<API_URL>/api/v1`; point scanners at that
same base.

> **Current coverage gap.** Only `GET /health` currently registers an OpenAPI
> path (`api/src/routes/health.ts`). The other routers serve traffic but do not
> yet call `openApiRegistry.registerPath`, so they are absent from the document
> and therefore invisible to the fuzzer and the ZAP API scan. Registering paths
> (with request/response Zod schemas and a `security` requirement) for `auth`,
> `visitor`, `chats`, `tenants`, `users`, `invitations`, and `admin` is the
> follow-up that makes this tooling bite. Until then the harness is wired and
> correct but exercises a single endpoint.
>
> **Register paths at module top level.** The spec is assembled by _importing_ >
> `api/src/routes/index.js` for its side effects — so a route only appears in
> the document (and under the fuzzer, the ZAP scan, and the spec-security
> tripwire) if its `openApiRegistry.registerPath(...)` call runs at **module
> load**, the way `api/src/routes/health.ts` does it. A `registerPath` placed
> _inside_ a `buildXRouter(deps)` factory is never executed by the import and
> stays silently invisible to all three checks. Keep registration at the top
> level of each route module.

## 1. Schemathesis fuzzing

`scripts/api-fuzz.sh` (npm: `npm run security:api-fuzz`) generates the spec,
selects a target, and runs `schemathesis run --checks all` against it. It
**skips cleanly (exit 0)** when `schemathesis` is not installed, so it is safe
to call from environments that do not have the Python tool.

```bash
# Against a running/staging API (recommended):
API_TARGET_URL=https://staging-api.afixt.com npm run security:api-fuzz

# Boot the local API itself (needs MySQL/Redis + the API env available):
npm run security:api-fuzz
```

Environment knobs:

| Variable                    | Default   | Meaning                                                        |
| --------------------------- | --------- | -------------------------------------------------------------- |
| `API_TARGET_URL`            | _(unset)_ | Base origin of a running API. When set, no local boot happens. |
| `SCHEMATHESIS_MAX_EXAMPLES` | `50`      | Hypothesis examples generated per operation.                   |
| `SCHEMATHESIS_ARGS`         | _(empty)_ | Extra args appended verbatim to `schemathesis run`.            |
| `BOOT_TIMEOUT_SECONDS`      | `40`      | How long to wait for a local boot's health probe.              |

Install: `pipx install schemathesis` (or `pip install schemathesis`).

`--checks all` runs Schemathesis's built-in checks — response status codes and
schemas conform to the spec, content types conform, and (importantly) the target
returns no unhandled 5xx / server errors for generated inputs.

**Do not** run the fuzzer against production. Use staging or an ephemeral
preview; generated inputs create and mutate data.

## 2. OWASP ZAP API scan

This is the **active**, OpenAPI-driven scan (`zaproxy/action-api-scan` /
`zap-api-scan.py`). It imports the spec, expands it into requests, and actively
probes each operation. It is deliberately **separate** from the passive baseline
scan in `.github/workflows/zap.yml` + `.github/zap/rules.tsv`, which are owned
elsewhere and unchanged here.

- **Rule tuning:** `.github/zap/api-scan-rules.tsv` (this PR). Owned, commented
  exclusions; injection / auth-bypass / CORS / missing-header rules stay at
  FAIL.
- **Spec input:** generate `openapi.json` as above and pass it as the scan
  `target` with `format: openapi`.

Run it manually against staging (mirrors what the action does):

```bash
API_URL=https://staging-api.afixt.com \
  node_modules/.bin/tsx api/src/scripts/generate-openapi.ts openapi.json

docker run --rm -v "$PWD:/zap/wrk:rw" -t ghcr.io/zaproxy/zaproxy:stable \
  zap-api-scan.py \
    -t /zap/wrk/openapi.json \
    -f openapi \
    -O https://staging-api.afixt.com \
    -c /zap/wrk/.github/zap/api-scan-rules.tsv \
    -r api-scan-report.html
```

The equivalent GitHub Action step (for a PR-preview or post-deploy job — **not**
a scheduled one, per the repo's no-scheduled-Actions policy) is:

```yaml
- name: ZAP API scan
  uses: zaproxy/action-api-scan@v0.9.0
  with:
    target: https://<preview-or-staging-host> # -O / OpenAPI server override
    format: openapi
    # The OpenAPI document to import. Generate it in a prior step to
    # <workspace>/openapi.json via api/src/scripts/generate-openapi.ts.
    api_definition: openapi.json
    rules_file_name: .github/zap/api-scan-rules.tsv
    fail_action: true
    cmd_options: '-a'
```

> **Policy note.** `.github/workflows/zap.yml` (the baseline) currently uses a
> `schedule:` trigger; per `CLAUDE.md` scheduled Actions are not allowed, and a
> DAST scan should run against a PR preview or as a post-deploy gate. That file
> is owned elsewhere and untouched by this change — the API scan documented here
> is intended to run event-driven against a preview/staging URL, not on a cron.

## 3. Spec security validation

`api/src/config/swagger.security.test.ts` (Vitest, no DB) asserts the generated
document is security-complete:

- `components.securitySchemes` exists and declares both mechanisms the API uses:
  - `bearerAuth` — `http` / `bearer`, JWT access token (staff & admin).
  - `visitorCookie` — `apiKey` in the `livechat_visitor` cookie (widget
    visitors).
- Every operation-level `security` requirement references a **declared** scheme.
- Every registered operation is either in the documented `PUBLIC_OPERATIONS`
  allowlist or carries a `security` requirement. Missing ones are printed
  (`[openapi-security]`) so they are visible in test output, and the test fails
  if a non-public operation ships without `security` — forcing the author to
  either protect it or explicitly mark it public.

The security schemes themselves are declared in `api/src/config/swagger.ts`
(`SECURITY_SCHEMES` + `registerComponent` calls), so they are part of the served
`/api/docs` document as well.

Run it:

```bash
npm --workspace api exec vitest run src/config/swagger.security.test.ts
```
