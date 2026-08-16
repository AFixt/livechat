## What

<!-- One-paragraph summary of the change. -->

## Why

<!-- Link to the issue or ADR driving this change. -->

## User-facing changes?

<!--
Per docs/adr/0002-usecase-dsl-mandate.md, every user-facing change needs a
matching usecases/**/*.uc.yaml update. Check ONE:

- [ ] Yes — I updated or added a usecase under `usecases/` and regenerated
      Playwright specs (`npm run usecases:generate`).
- [ ] No — this change is API-only, service-only, test-only, or otherwise
      has no observable effect in the customer widget, support console, or
      admin console.
- [ ] Yes but exempted — I've added the `skip-usecases` label and explained
      below. (Use sparingly.)
-->

## Cookies / storage

<!--
Per issue #54 and docs/privacy/cookie-inventory.md, every cookie, storage key,
or browser-persisted value the widget or its visitor API touches must be listed
in the inventory. Check ONE:

- [ ] This change adds/removes/alters a cookie or browser-storage key — I
      updated `docs/privacy/cookie-inventory.md` (and the vendor disclosure if
      the data category changed).
- [ ] No cookie or browser-storage behavior changed.
-->

## Test plan

<!--
- [ ] `npm run check:all` passes locally
- [ ] Manually verified the affected flow in a browser (or via the
      generated Playwright spec)
- [ ] If touching auth/chat/socket.io, `npm test` with
      `docker compose up -d mysql redis mailhog minio` passes
-->

## Screenshots / recordings

<!-- For UI changes. Omit if not applicable. -->
