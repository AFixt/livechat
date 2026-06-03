{"message":"Not Found","documentation_url":"https://docs.github.com/rest/repos/contents#get-repository-content","status":"404"}
## @afixt scoped packages & NPM_TOKEN

If this project installs any `@afixt/*` scoped packages, npm authentication is handled by an **organization-level GitHub Actions secret** named `NPM_TOKEN`. The org-level secret is **always** the one to use.

- Installing `@afixt/*` scoped packages should **not** return `404`. A `404` here is an authentication/token problem, not a missing package.
- If you do hit a `404`, remove any **repo-level** `NPM_TOKEN` secret — a repo-level token is likely stale and conflicts with the org-level secret.
- Do not override `NPM_TOKEN` per repository; always rely on the org-level secret.
