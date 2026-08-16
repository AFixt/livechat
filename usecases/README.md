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

## `type`: positive vs negative vs extension

Per ADR-0002 every use case declares a `type`. The three are not interchangeable
— pick by **what the flow represents**, not by whether it uses `extends`:

- **`positive`** — the primary happy path of an interaction: valid input, the
  expected success outcome. One per interaction.
- **`negative`** — an **error / rejection / guard** path: invalid input, a
  refused action, or a control that must be disabled. The observable outcome is
  a failure surfaced accessibly (an `alert`, a `field_error`, a `disabled`
  control, staying on the same URL). ADR-0002 requires one for every error path.
- **`extension`** — a **valid alternate flow or distinct state** that is not an
  error: declining an optional step, a returning-visitor resume, a
  support-initiated state. It succeeds; it is just not the primary path.

Rule of thumb: if the outcome the use case asserts is an error being shown or an
action being prevented, it is `negative`; if it is a different-but-valid result,
it is `extension`. `extension` is not a catch-all for "anything that isn't the
main positive case."

## `expected_result`

Every non-`extends` use case carries an `expected_result` — a one-line statement
of the **observable outcome**, independent of the steps taken to reach it. It
lets a reviewer check that the `verify` steps actually establish the outcome the
use case claims. `extends` variants inherit their parent's intent and state
their delta in `steps_override`, so they omit it.

## Naming

- One use case per file. Filename is kebab-case matching the use case id.
- Positive cases: `<flow>.uc.yaml` (e.g., `customer-initiates-chat.uc.yaml`)
- Negative cases: `<flow>--<failure>.uc.yaml` (e.g.,
  `customer-initiates-chat--invalid-email.uc.yaml`)
- Extension cases: `<flow>--<variant>.uc.yaml`
- Variant cases (negative or extension) express their delta with `extends:` +
  `steps_override:` + `from_step:` rather than copying the parent's steps.

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
