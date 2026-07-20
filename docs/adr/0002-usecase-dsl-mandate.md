# ADR-0002: Every user interaction is documented in the @afixt/usecase-runner DSL

- **Status:** Accepted
- **Date:** 2026-04-24
- **Deciders:** Karl Groves

## Context

Accessibility is the core differentiator of this product (requirements.md §4.1).
AFixt maintains an in-house DSL — `@afixt/usecase-runner` — that describes user
interactions in accessibility-tree terms (`getByRole`, `getByLabel`) rather than
CSS selectors or XPath. If an element isn't exposed in the accessibility tree, a
usecase-driven test fails. That's the whole point.

## Decision

Every user-facing interaction in this product — customer widget flows, support
console actions, admin flows — MUST have a corresponding `.uc.yaml` file under
`usecases/` following the `@afixt/usecase-runner` DSL.

- The `.uc.yaml` is the source of truth for behavior. When behavior changes, the
  use case is updated first, then the implementation.
- Organization: `usecases/widget/<flow>.uc.yaml`,
  `usecases/support/<flow>.uc.yaml`, `usecases/admin/<flow>.uc.yaml`.
- Required coverage: one positive case per user flow; negative cases for
  validation errors and error paths; extension cases for state variants.
- `npm run usecases:validate` runs in `npm run check` and in CI.
- `npm run usecases:generate` produces Playwright `.spec.ts` files into
  `ui/e2e/generated/` and `widget/e2e/generated/`. Generated specs are committed
  but auto-generated — never hand-edited.
- A CI diff gate (`usecases-diff-gate` job in `.github/workflows/ci.yml`) fails
  any PR that changes `ui/src/**` or `widget/src/**` without also changing
  `usecases/**`.

## Consequences

**Easier:**

- Behavior is described once, in accessibility-tree terms, then mechanically
  translated into tests — no drift between "what we said the UX is" and "what
  the tests check."
- New contributors read `.uc.yaml` files to understand the product, not buried
  test code.
- Regressions that break the accessibility tree are caught because the tests
  can't even locate elements.

**Harder:**

- Every UX change requires at least two artifacts (`.uc.yaml` + impl). Small
  polish PRs are not exempt.
- Some interactions (drag-and-drop, fine-grained gestures) don't map cleanly to
  the DSL's six core keywords — these need to be avoided or captured with `note`
  steps and manual supplementary tests.

## Alternatives considered

- **Hand-written Playwright specs** — rejected; the whole selector vocabulary
  diverges from accessibility tree, making it easy to ship inaccessible UIs that
  still "pass."
- **Playwright with `axe-core` assertions only** — rejected; catches violations
  after the fact but doesn't force accessibility into the interaction model.

## Links

- `/users/karlgroves/projects/AFixt/usecase-runner/spec.md`
- `/users/karlgroves/projects/AFixt/usecase-runner/meetabl-login-sample.yml`
- requirements.md §4.1, §5.1, §5.2
