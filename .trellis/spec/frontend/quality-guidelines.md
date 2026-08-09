# Quality Guidelines

> Required checks, tests, accessibility, and review rules for frontend changes.

## Static Quality Gate

Use the repository scripts rather than ad hoc tool flags:

```bash
pnpm check
pnpm typecheck
pnpm test
pnpm build
```

- `biome.json` uses Biome 2.4.5 recommended rules, tab indentation, double
  quotes, import organization, and Tailwind directive parsing.
- `tsconfig.json` is strict and no-emit.
- `vitest.config.ts` runs ordinary tests in jsdom with shared setup from
  `src/test/setup.ts`; database tests and Playwright tests are separate suites.
- `src/routeTree.gen.ts` is generated and excluded from Biome. Run
  `pnpm generate-routes` when route files change.
- Before TanStack architecture/library edits, run `pnpm intent:list` and load
  the most specific matching local Intent guidance required by `AGENTS.md`.
- Treat `AGENTS.md` and verified production code as authoritative over the
  scaffold-era `.cursorrules`. In particular, the application has a light-only
  theme in `src/styles.css`, Tailwind 4 is configured through `vite.config.ts`,
  and Sentry stays behind `src/lib/sentry.client.ts`, `src/lib/sentry.ts`, and
  server-owned integrations rather than the scaffold's generic browser import.

## Testing Requirements

### Colocated unit and component tests

Add or update the closest `*.test.ts[x]` for behavior, not implementation
details.

- UI primitive semantics: `src/components/ui/field.test.tsx`,
  `src/components/ui/pagination.test.tsx`, and
  `src/lib/i18n/i18n.test.tsx`.
- Feature interactions and accessible states:
  `src/features/programs/programs-page.test.tsx`,
  `src/features/administrators/administrators-page.test.tsx`, and
  `src/features/monitoring/audit-page.test.tsx`.
- Stores/cache/workflows: `src/features/shell/ui-store.test.ts`,
  `src/features/versions/cache.test.ts`, and
  `src/features/versions/upload-workflow.client.test.ts`.

Use `@solidjs/testing-library` role/label queries and real user-visible
outcomes. Provide `QueryClientProvider`/`I18nProvider` when the component needs
them, disable query retry where deterministic failure behavior matters, stub
external transport at the boundary, and clean up globals/controllers.

### Browser and environment-backed coverage

- `pnpm test:e2e` runs desktop and mobile Playwright projects on an isolated
  strict loopback port. `playwright.config.ts` keeps `strictPort` and
  `reuseExistingServer: false`; a foreign local app must never satisfy this
  suite's `/health` readiness probe. `tests/e2e/responsive-accessibility.spec.ts`,
  `tests/e2e/program-management.spec.ts`, and
  `tests/e2e/authenticated-shell.spec.ts` are patterns.
- Credential-gated tests must explicitly skip when
  `E2E_ADMIN_EMAIL`/`E2E_ADMIN_PASSWORD` are absent; never fake a pass.
- `pnpm test:db` requires a disposable database plus the exact sentinel from
  `AGENTS.md`; never aim it at shared or production data.
- A requested E2E acceptance pass means operating the real full-stack app in
  the in-app browser. Passing Playwright alone is regression evidence, not a
  substitute for that acceptance pass.
- Real OSS, Netlify Preview, Sentry, and destructive DB gates remain
  environment-backed. Mocked tests do not prove those integrations.

## Accessibility and UX Quality

- Test labels, roles, keyboard flow, focus restoration, and live/error
  announcements. Examples: `src/components/ui/field.test.tsx`,
  `src/features/programs/programs-page.test.tsx`, and
  `tests/e2e/responsive-accessibility.spec.ts`.
- Preserve native semantics, Kobalte focus management, visible focus rings,
  table captions/scopes, localized `aria-label`s, and `role="alert"` errors.
  Reference `src/components/ui/dialog.tsx`,
  `src/features/programs/program-table.tsx`, and
  `src/features/monitoring/release-trend-chart.tsx`.
- Verify both 1920px desktop and 390px mobile behavior for shell/layout changes;
  the viewports are defined in `playwright.config.ts`.
- Keep the reduced-motion rule in `src/styles.css`, and make navigation retain
  its visible destination feedback without unmounting the current outlet; see
  `src/features/shell/app-shell.tsx` and
  `src/features/shell/navigation-pending.test.tsx`.
- Authenticated leaf pages intentionally have no opacity/translate entry
  animation. Pending skeletons and the destination overlay communicate cold
  navigation without flashing every warm or repeated navigation; a
  `.page-enter` class is layout-only unless an approved design changes this.
- Localize production copy in both catalogs and test by role/name rather than a
  brittle CSS selector where possible.

## Security and Contract Checks

- Client code calls the same-origin typed adapter in `src/lib/api/client.ts`;
  feature APIs such as `src/features/programs/api.ts`,
  `src/features/versions/api.ts`, and
  `src/features/settings/system-api.ts` do not implement their own fetch policy.
- Better Auth is the deliberate separate transport surface:
  `src/lib/auth-client.ts` owns only sign-in, sign-out, and revoke-other-session
  POSTs, caps a sign-in error body at 1,024 bytes, and exposes only application
  error codes. Keep this exception centralized and covered by
  `src/lib/auth-client.test.ts`.
- Optimistic-concurrency mutations pass a `WeakEntityTag` through the shared
  client, which sends `UPDATER_IF_MATCH_HEADER`. Tests in
  `src/features/programs/program-dialogs.test.tsx`,
  `src/features/settings/system-page.test.tsx`, and
  `src/features/versions/api.test.ts` assert the wire header.
- Do not render server Problem `detail` values. Safe localized errors and
  bounded request IDs are handled by `src/lib/i18n/i18n.tsx`; behavior is
  covered by `src/features/programs/programs-page.test.tsx` and
  `src/lib/api/client.test.ts`.
- Keep secrets, database clients, and server auth modules out of browser and
  isomorphic bundles. Browser STS/File/checkpoints remain memory-only.
- Browser Sentry stays behind the `createClientOnlyFn` loader in
  `src/lib/sentry.ts`; when `VITE_SENTRY_DSN` is empty, do not import
  `src/lib/sentry.client.ts` or the SDK. This boundary is covered by
  `src/lib/sentry.test.ts`.

## Forbidden Patterns

- No manual edits to generated route files and no server/business mutations in
  ordinary route loaders. Feature/browser runtime code must not import
  `.server` modules; erased `import type` references and the server half of the
  explicit `createServerFn` in `src/lib/session-query.ts` are the two current
  boundary forms, not general exceptions.
- No raw `fetch` scattered through components, no ad hoc query keys, and no
  standard `If-Match`/dual-read fallback.
- No test that only repeats the implementation or passes after the feature is
  removed. Assert externally visible behavior or a contract boundary.
- No real credentials in fixtures, committed environment files, screenshots,
  errors, browser storage, logs, or Sentry payloads.
- No inaccessible icon-only controls, click-only keyboard traps, untranslated
  labels, or focus loss caused by remounting controls.
- No claim that a skipped, mocked, DNS-failed, or environment-gated check passed.

## Review Checklist

- [ ] Ownership matches `routes` / `features` / `components/ui` / `lib` /
      `shared` boundaries.
- [ ] URL, Query, local signal/form, and Store state are assigned to the correct
      owner and lifetime.
- [ ] Reactive props remain reactive; effects and resources have cleanup.
- [ ] Loading, stale-data, empty, error, retry, and optimistic rollback paths
      are covered where relevant.
- [ ] Keyboard, focus, labels, mobile layout, reduced motion, and localization
      are preserved.
- [ ] DTOs, query keys, ETags, and error rendering use the shared contracts.
- [ ] Relevant unit/component tests pass, plus E2E/build/environment gates in
      proportion to the change.
