# Hook and Reactive Logic Guidelines

> How Solid reactive primitives and reusable stateful logic are used.

## Overview

This is Solid, so reusable logic is not organized around React-style hooks.
Only functions that consume an owner/context/store selector use the `use*`
name. Controllers, query option factories, validators, and pure helpers keep
descriptive `create*`, `*QueryOptions`, `validate*`, or domain names.

The two project-defined `use*` functions illustrate the rule:

- `src/lib/i18n/i18n.tsx` exports `useI18n()` to read a Solid context and throws
  when the provider is absent.
- `src/features/shell/ui-store.ts` exports `useShellUiSelector()` and returns an
  `Accessor<Selected>` from TanStack Store.

Other reusable stateful logic deliberately uses controller factories:
`createUploadQueueController` in `src/features/versions/upload-store.ts`,
`createUploadWorkflow` in `src/features/versions/upload-workflow.client.ts`,
and `createShellUiController` in `src/features/shell/ui-store.ts`.

## Reactive Primitive Selection

- Use `createSignal` for component-local mutable UI state such as filter text,
  pending flags, and focused triggers. Examples:
  `src/features/programs/programs-page.tsx`,
  `src/features/administrators/administrators-page.tsx`, and
  `src/features/auth/login-form.tsx`.
- Use `createMemo` for derived values with multiple consumers or non-trivial
  work. Examples: normalized list search in
  `src/features/programs/programs-page.tsx`, chart geometry in
  `src/features/monitoring/release-trend-chart.tsx`, and visible upload rows in
  `src/features/versions/upload-queue.tsx`.
- Use plain accessor functions for small derivations where memoization adds no
  value, such as `pageCount`/`rangeStart` in
  `src/features/programs/programs-page.tsx`, status helpers in
  `src/features/versions/version-dialogs.client.tsx`, and `systemSettings` in
  `src/features/shell/app-shell.tsx`.
- Use `createEffect` for synchronization or external effects, not as a general
  derivation mechanism. Search-to-filter sync in
  `src/features/programs/programs-page.tsx`, document language sync in
  `src/lib/i18n/i18n.tsx`, and tab retitling in the versions route are
  representative.
- Use `on(...)` when an effect must react to a precise dependency or needs the
  previous value. Dialog/focus effects in
  `src/features/programs/programs-page.tsx`,
  `src/features/versions/versions-page.tsx`, and
  `src/features/versions/version-form.tsx` follow this pattern.

Read `props.someValue` inside the reactive closure. Do not destructure a prop or
call an accessor once outside `createMemo`, `createEffect`, or the query-options
thunk and expect it to remain reactive.

## Lifecycle and Cleanup

- Pair timers, subscriptions, animation frames, workers, and workflow
  controllers with `onCleanup`. Examples are the copy timer in
  `src/features/programs/program-table.tsx`, router subscriptions in
  `src/features/shell/app-shell.tsx`, and upload sessions in
  `src/features/versions/version-dialogs.client.tsx`.
- Use `onMount` only for browser lifecycle work.
  `src/features/shell/app-shell.tsx` hydrates the per-account shell and
  subscribes to navigation; `src/lib/i18n/i18n.tsx` reads browser
  locale storage after mount.
- Controller factories expose explicit `dispose()` methods outside a component
  owner. `src/features/versions/upload-store.ts`,
  `src/features/versions/upload-workflow.client.ts`, and
  `src/features/versions/credential-manager.client.ts` are tested with explicit
  cleanup.

## Data Fetching

- TanStack Query owns server state. Put reusable `queryOptions(...)` factories
  in each feature's `queries.ts`: `src/features/programs/queries.ts`,
  `src/features/monitoring/queries.ts`, and
  `src/features/settings/system-queries.ts`.
- Components create reactive queries with a thunk when inputs can change:
  `src/features/programs/programs-page.tsx`,
  `src/features/monitoring/audit-page.tsx`, and
  `src/features/versions/versions-page.tsx` call
  `createQuery(() => ...QueryOptions(...))`.
- Query functions accept and forward TanStack Query's `AbortSignal`; see
  `src/features/programs/queries.ts`, `src/features/monitoring/queries.ts`, and
  `src/features/versions/queries.ts`.
- Routes use `ensureQueryData` for auth guards and non-blocking `prefetchQuery`
  for warm data. See `src/routes/_authenticated.tsx`, `src/routes/login.tsx`,
  and `src/routes/_authenticated/programs.$programId.versions.tsx`.
- `src/router.tsx` keeps `defaultPreloadStaleTime: 0`; TanStack Query, not the
  Router preload cache, owns server-data freshness. Do not add a second Router
  freshness window for Query-owned data.
- List routes resolve an omitted system page size synchronously through
  `src/features/settings/system-defaults.ts`: a cached Query value wins,
  uncached navigation uses the product fallback `20`, and either path starts a
  background prefetch instead of blocking the route. Explicit URL page size
  remains authoritative. Preserve the behavior covered by
  `src/features/settings/system-defaults.test.ts`.
- Centralize normalized keys in `src/lib/api/query-keys.ts`; mutations reconcile
  through feature cache helpers such as `src/features/programs/cache.ts`,
  `src/features/versions/cache.ts`, and
  `src/features/settings/system-cache.ts`.

## Avoided and Forbidden Patterns

- Do not create a `use*` wrapper for a pure formatter, validator, API function,
  or query-options factory.
- Do not fetch in `createEffect` when TanStack Query can own cancellation,
  caching, errors, and stale data.
- Do not construct ad hoc query-key arrays in components; use
  `src/lib/api/query-keys.ts`.
- Do not use an effect merely to copy query data into a signal. Render/query
  from the cache and derive with accessors or memos.
- Do not start timers/subscriptions/workers without cleanup, and do not persist
  controller instances past their owning page/session.
- Do not make ordinary route loaders await business lists just to render the
  destination shell. The established route pattern keeps navigation responsive
  and lets Solid Query render cached/pending/error states. The synchronous
  system-default resolver above is the reference pattern when a setting is
  needed to canonicalize route search without adding a blocking loader.
