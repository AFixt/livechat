# Use cases (`.uc.yaml`)

Per [ADR-0002](../docs/adr/0002-usecase-dsl-mandate.md), **every user-facing
interaction in this product has a `.uc.yaml` file here** following the
[`@afixt/usecase-runner`](https://github.com/AFixt/usecase-runner) DSL.

## Layout

```text
usecases/
  widget/       Customer-facing widget flows (all eight states from requirements.md §5.1)
  support/     Support console flows (requirements.md §5.2)
  admin/       Admin console flows
```

## Naming

- One use case per file. Filename is kebab-case matching the use case id.
- Positive cases: `<flow>.uc.yaml` (e.g., `customer-initiates-chat.uc.yaml`)
- Negative cases: `<flow>--<failure>.uc.yaml` (e.g.,
  `customer-initiates-chat--invalid-email.uc.yaml`)
- Extension cases: `<flow>--<variant>.uc.yaml` using `extends:` +
  `steps_override:` + `from_step:`

## Workflow

1. **Write the `.uc.yaml` first.** It is the source of truth for behavior.
2. `npm run usecases:validate` — static validation via
   `usecase-runner validate`.
3. `npm run usecases:generate` — regenerates Playwright specs into
   `ui/e2e/generated/` and `widget/e2e/generated/`. These are committed but
   auto-generated — never hand-edit.
4. `npm run test:e2e` — runs the generated specs.

## DSL reference

See `/users/karlgroves/projects/AFixt/usecase-runner/spec.md` for the full DSL
and `meetabl-login-sample.yml` in that repo for a worked example.

Quick reference — the six core keywords:

| Keyword    | Purpose                                             |
| ---------- | --------------------------------------------------- |
| `locate`   | Assert element is visible in the accessibility tree |
| `focus`    | Assert element receives keyboard focus              |
| `enter`    | Type into a field                                   |
| `select`   | Pick from a choice (checkbox/radio/select)          |
| `activate` | Click/press a button/link                           |
| `verify`   | Assert some outcome (URL, alert, field_error, etc.) |

Elements are always targeted by `getByRole()` or `getByLabel()` — never CSS
selectors. If an element isn't in the accessibility tree, the test fails, and
that's intentional.
