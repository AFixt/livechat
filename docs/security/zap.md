# OWASP ZAP baseline scan

The ZAP baseline is a passive DAST pass over a running deployment: it crawls the
target, watches the traffic, and reports missing headers, information leaks, and
other passive findings. It never attacks — no injection, no fuzzing — so it is
safe to point at a real preview or staging environment.

- **Workflow:** [`.github/workflows/zap.yml`](../../.github/workflows/zap.yml)
- **Rule tuning:** [`.github/zap/rules.tsv`](../../.github/zap/rules.tsv)
- **Target:** the `ZAP_TARGET_URL` repo variable (or the `target_url`
  `workflow_dispatch` input). With neither set, the scan no-ops rather than
  failing — see ADR-0005.

## Running it

### In CI

Trigger the workflow manually (`workflow_dispatch`) once a preview/staging URL
exists, passing `target_url`, or set the `ZAP_TARGET_URL` repository variable so
the deploy-gated runs have a target. The job fails the build on any finding left
at `FAIL` threshold and writes the rest as warnings.

### Locally

Point the official baseline image at any reachable URL, mounting the same rule
file the CI job uses so local and CI verdicts match:

```bash
docker run --rm -v "$(pwd)/.github/zap:/zap/wrk:ro" \
  ghcr.io/zaproxy/zaproxy:stable \
  zap-baseline.py -t https://your-preview-url.example.com \
  -c rules.tsv -a -j
```

- `-c rules.tsv` applies the tuned thresholds (this file is what the workflow
  passes via `rules_file_name`).
- `-a` includes the alpha passive rules; `-j` uses the AJAX spider so the SPA
  routes in the console are actually crawled.

## The exclusions, and why each exists

Every override lives in [`.github/zap/rules.tsv`](../../.github/zap/rules.tsv)
with an inline comment. Thresholds are `IGNORE` (suppress), `WARN` (report,
don't fail), or `FAIL`. The defaults are strict; the current set is:

| Rule                             | ID    | Level  | Reason                                                                                                    |
| -------------------------------- | ----- | ------ | --------------------------------------------------------------------------------------------------------- |
| Incomplete/No Cache-control      | 10015 | IGNORE | API JSON is non-cacheable by default; the static hosts set `Cache-Control` explicitly.                    |
| Timestamp Disclosure             | 10096 | IGNORE | `created_at`/`expires_at`/numeric ids are intended API data, not secrets.                                 |
| Suspicious Comments              | 10027 | IGNORE | Heuristic hits on minified bundles; no secrets ship in client JS (enforced by trufflehog + `no-secrets`). |
| Site Isolation vs Spectre (COEP) | 90004 | WARN   | COEP is intentionally unset so the widget stays cross-origin embeddable (ADR-0011).                       |
| Permissions-Policy Not Set       | 10063 | WARN   | API responses have no browsing context; the console sets `Permissions-Policy`.                            |

When a genuinely new header or configuration lands, remove the corresponding
line so the rule fails again — an override is a debt, not a default. Add a new
line only with a one-line justification, the same as the entries above.

## Relationship to the static-host header work

Issue #61 (ADR-0011) added CSP/COOP/CORP/HSTS to the console and widget nginx
hosts and a config-lint (`npm run security:headers`) that checks the header
_declarations_. ZAP is the complementary runtime check: it confirms the headers
actually reach the browser on a live deployment, where the config-lint cannot.
