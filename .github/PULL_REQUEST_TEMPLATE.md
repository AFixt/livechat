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
