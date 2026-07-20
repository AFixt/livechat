# ADR-0007: Cross-ends e2e journeys complement the generated usecase specs

- **Status:** Accepted
- **Date:** 2026-07-20
- **Deciders:** Karl Groves

## Context

ADR-0002 makes every user interaction a `.uc.yaml`, from which
`@afixt/usecase-runner` generates one Playwright spec per usecase. That DSL is
single-page and single-actor by design: a usecase has one `start_location` and
targets one page through `getByRole`/`getByLabel`.

The product's central behaviour cannot be expressed that way. A customer in the
widget and an agent in the console talk to each other over live Socket.IO — two
pages, two actors, real-time propagation between them. A single usecase can
assert that a visitor sees their own message echoed, but never that an agent
receives it and replies. Several usecases also declare preconditions (an
authenticated operator, an already-active chat) that a standalone generated spec
cannot establish, so those specs cannot run in isolation.

Building this coverage also surfaced that the generated suite had never been
executable: no seed/fixtures, no auth harness, and CI never ran it (issue #6).

## Decision

Add a second, hand-written e2e layer that **complements** the generated specs;
it does not replace them and does not weaken ADR-0002.

- A root `e2e/` workspace holds cross-ends **journey** specs that drive two
  browser contexts at once against a real stack: the widget, the console, the
  api, MySQL, Redis, and MailHog.
- Journeys compose interactions that already have usecase coverage; they add the
  cross-actor, real-time, and multi-step assertions the DSL cannot express. They
  are exempt from the per-interaction `.uc.yaml` rule precisely because they
  introduce no new interaction — only new orchestration of existing ones.
- The stack runs on **dedicated ports** against a dedicated `livechat_e2e`
  database, seeded fresh per run, so a journey never collides with a dev stack
  or dev data. The api integration tests move to their own `livechat_test`
  database for the same reason.
- The generated specs are made executable by reusing the same seed and a stored
  auth state. Specs whose preconditions a single usecase cannot establish, and
  the one blocked by a DSL/MUI limitation (`admin-invite-user`, `widget-close`,
  `widget-actively-chatting`), are excluded from the run with a documented
  reason rather than hand-edited.
- CI runs both layers (`npm run test:e2e`).

## Consequences

- The product's flagship flow — visitor↔agent live chat — is now guarded end to
  end; the regression that hid there (visitor-initiated chats never reaching the
  console) would now fail the build.
- Two e2e layers exist. The journeys are the source of truth for cross-ends
  behaviour; the generated specs remain the per-usecase accessibility-tree gate.
- Page-level a11y is **not** asserted in the journeys: `@afixt/a11y-assert`'s
  Playwright adapter falls back to jsdom and throws on `getComputedStyle`, so a
  page scan false-passes. A11y stays enforced at the component layer (jsdom,
  where the adapter works) and at the widget built-preview gate.
- We commit to keeping the seed dataset and the fixtures the specs assert on in
  sync (both live under `e2e/support/`).

## Alternatives considered

- **Extend the usecase DSL to multi-context.** Rejected: `@afixt/usecase-runner`
  is a shared external tool; multi-actor real-time flows are out of its scope
  and would be a large upstream change.
- **Only fix the generated specs.** Rejected: they are single-page/single-actor
  and structurally cannot cover the cross-ends round trip, which is the whole
  point of the product.
- **Drive a11y in the journeys too.** Rejected for now: the adapter is not
  usable under Playwright (jsdom `getComputedStyle`), so it would false-pass.

## Links

- requirements.md §3, §5.1 (customer widget flows), §4.1 (accessibility)
- ADR-0002 (usecase DSL mandate), ADR-0003 (widget framework)
- Issues #6 (generated suite executability), #19 (untenanted-staff sockets), #21
  (widget/console states rendered but never triggered)
