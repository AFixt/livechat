# ADR-0003: Use Preact + Web Component + Shadow DOM for the customer widget

- **Status:** Proposed
- **Date:** 2026-04-24
- **Deciders:** Karl Groves

## Context

The customer-facing widget (requirements.md §5.1, §6.2) must:

- Embed on arbitrary client sites via a single `<script>` tag
- Coexist with any host-page framework (React, Vue, Angular, vanilla)
- Not leak styles into or out of the host page
- Meet a strict size budget (target &lt;50KB gzipped) — `size-limit` is a build
  gate
- Remain fully accessible, including through the Shadow DOM boundary
- Work without JavaScript frameworks on the host page

The support and admin consoles (`ui/`) use React 19 + MUI 7. Using the same
stack for the widget would break the size budget badly (React 19 alone is larger
than our target).

## Decision

Implement the customer widget as a **Web Component** backed by **Preact**,
rendered inside **Shadow DOM** for style isolation.

- Preact (v10) for component ergonomics without React's bundle cost
- Custom Element (`<afixt-livechat>`) registers on widget script load
- Shadow DOM (open mode) for style isolation — but explicitly tested to confirm
  accessible-name and focus traversal work through the shadow boundary
- Built with Vite library mode; `size-limit` enforces the budget
- No MUI, no `@emotion`, no `dompurify` (we don't render third-party HTML in the
  widget — all visitor-submitted text is rendered as plain text)

## Consequences

**Easier:**

- Predictable isolation on hostile host pages
- Team keeps JSX mental model across `ui/` and `widget/`
- Small enough to not noticeably slow down client sites

**Harder:**

- Shadow DOM a11y testing needs deliberate setup — `@afixt/a11y-assert` must run
  against the shadow root, not just `document`
- Web Component lifecycle edges (attributeChangedCallback timing,
  disconnectedCallback cleanup) need careful handling
- Per-client theming via CSS custom properties must be validated at the tenant
  config level to prevent CSS injection

## Alternatives considered

- **React 19 same as `ui/`** — rejected; exceeds size budget by >3x.
- **Lit** — viable, smaller core than Preact, but the team has more Preact/React
  familiarity and JSX is easier for `@afixt/usecase-runner` contributors to
  reason about.
- **Vanilla TS** — smallest output; rejected because the maintenance cost of
  managing eight chat states (§5.1.1–8) by hand outweighs the size win.
- **iframe-based widget** — rejected; iframes complicate the accessibility story
  (focus management across the boundary), complicate responsive layout, and slow
  first paint.

## Links

- requirements.md §5.1 (eight customer-widget states), §6.2 (JS-snippet
  embedding)
- ADR-0002 (usecase DSL must work against the widget's accessibility tree)
