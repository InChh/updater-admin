# State Management

> How frontend state is divided by owner and lifetime.

## State Categories

Use the narrowest owner that matches the state. The application currently has
five distinct categories; they are not interchangeable.

### URL state: shareable list and dialog state

Filters, pagination, sorting, selected dialog kind, and selected row IDs belong
in validated TanStack Router search params. Feature pages receive a reactive
search accessor and emit the complete next search object.

Examples:

- `src/features/programs/search.ts` models list state plus a discriminated
  create/edit/delete dialog union; `src/features/programs/programs-page.tsx`
  updates it.
- `src/features/versions/search.ts` carries page/sort/dialog/version ID state;
  `src/features/versions/versions-page.tsx` clamps invalidated pages after
  mutations.
- `src/features/monitoring/search.ts` owns overview windows and audit filters;
  `src/features/monitoring/audit-page.tsx` keeps filter inputs synchronized
  with it.

Search validators accept `Record<string, unknown>`, normalize unsafe values,
and return canonical defaults before components see the state. Routes wire them
through `validateSearch`, `loaderDeps`, and typed `useSearch`.

### Server state: TanStack Query

API responses, session data, loading/error status, cache freshness, and mutation
reconciliation belong to TanStack Query.

Examples:

- `src/features/programs/queries.ts`, `src/features/monitoring/queries.ts`, and
  `src/features/settings/system-queries.ts` define query ownership and freshness
  behavior.
- `src/lib/api/query-keys.ts` normalizes all domain query keys.
- `src/features/programs/cache.ts`, `src/features/versions/cache.ts`, and
  `src/features/settings/system-cache.ts` centralize cache
  updates/invalidation.

Keep usable cached data visible during a background error, as implemented in
`src/features/programs/programs-page.tsx`,
`src/features/versions/versions-page.tsx`, and
`src/features/monitoring/monitoring-overview-page.tsx`.
For optimistic mutations, snapshot/cancel/patch/rollback/reconcile in that
order; version activation in `src/features/versions/versions-page.tsx` and
`src/features/versions/cache.ts` is the reference implementation.

### Local component and form state

Use Solid signals for transient state owned by one mounted component: input
drafts, pending actions, error text, dialog return-focus elements, and visual
windowing. Use TanStack Form for field values/validation.

Examples:

- `src/features/programs/programs-page.tsx` owns filter text and dialog focus.
- `src/features/auth/login-form.tsx` owns submit/error state and form values.
- `src/features/versions/upload-queue.tsx` owns the current render-window start.
- `src/features/programs/program-form.tsx`,
  `src/features/administrators/administrator-form.tsx`, and
  `src/features/settings/system-form.tsx` use `createForm` instead of a
  hand-built field store.

### Cross-shell UI state: TanStack Store

Use TanStack Store only for client UI state shared across shell concerns or
required to survive navigation changes. The shell store is account-scoped and
controller-owned. `AppShell` owns the main selectors and navigation
coordination, then passes controlled props and callbacks to presentational
shell children. Narrow route/settings owners may call the controller or a
selector for shell-specific side effects; leaf shell components still remain
controlled.

Examples:

- `src/features/shell/ui-store.ts` owns opened tabs, active tab, sidebar state,
  mobile navigation state, and locale.
- `src/features/shell/app-shell.tsx` consumes the store through
  `useShellUiSelector` and mutates it through `shellUiController`.
- `src/features/shell/sidebar.tsx` and `src/features/shell/tabs.tsx` are
  controlled components: they receive the selected values and callbacks from
  `AppShell` rather than importing the store directly.
- `src/routes/_authenticated/programs.$programId.versions.tsx` is the other
  selector consumer: it observes the matching opened tab and retitles it after
  the program query resolves. `src/routes/_authenticated.tsx` and
  `src/features/settings/profile-form.tsx` call the controller directly for
  locale/session transitions; they do not make presentational shell children
  store-aware.
- `src/features/shell/ui-store.test.ts` verifies hydration, account switching,
  tab retention, close fallback, validation, and persistence.

Opened tabs are stateful navigation history, not a projection of the current
route. A route change opens/activates one tab without replacing prior tabs.
`/programs` is the non-closable pinned tab. `AppShell` renders the tab strip
immediately after `Topbar` and before the page outlet; closing the active tab
navigates to its left neighbor, falling back to `/programs`. Preserve the
program-scoped key and concrete href for each version tab. These behaviors are
implemented in `src/features/shell/ui-store.ts`,
`src/features/shell/app-shell.tsx`, and `src/features/shell/tabs.tsx` and are
covered by `src/features/shell/ui-store.test.ts`.

An exact click on the current sidebar destination or current tab href is a
no-op; it must not remount the leaf or start another business request.
`AppShell.navigateTo` compares the complete href, while
`isCurrentSidebarDestination` deliberately compares exact pathnames so the
nested versions route can still navigate back to `/programs`. Keep these two
comparisons distinct; see `src/features/shell/app-shell.tsx`,
`src/features/shell/sidebar.tsx`, and `src/features/shell/sidebar.test.ts`.

### Long-running page sessions: scoped TanStack Store controllers

The release upload queue is too long-lived for dialog-local signals but must not
be application-global. The client implementation of `VersionDialogs`, reached
through `src/features/versions/version-dialogs.tsx` and still owned by the
versions page, keeps sessions keyed by draft/version while dialogs close and
reopen, and disposes all sessions when that owner unmounts.

Examples:

- `src/features/versions/upload-store.ts` owns serializable presentation plus
  in-memory `File`, progress, failure, and multipart checkpoint state.
- `src/features/versions/version-dialogs.client.tsx` creates, promotes, reuses,
  and disposes per-draft upload sessions. Each session also retains its edited
  `UploadExclusionConfig` in memory while the page owner remains mounted.
- `src/features/versions/upload-workflow.client.ts` coordinates bounded async
  work against the queue controller and publishes completed hash results in
  bounded batches before the entire folder finishes.
- `src/features/versions/program-versions-data-boundary.tsx` keeps the
  upload-owning subtree mounted when Query replaces the program data object.
  Do not key or remount that subtree on a successful background refresh; its
  mount stability and reactive data update are covered by
  `src/features/versions/program-versions-data-boundary.test.tsx`.
- `src/features/versions/upload-queue.tsx` retains the complete controller
  queue but renders a navigable window of 100 rows. This is a UI work bound,
  not a release file-count cap; `src/features/versions/upload-queue.test.tsx`
  verifies both properties.

## Persistence Boundaries

- `src/features/shell/ui-store.ts` persists validated, versioned,
  account-scoped shell preferences to `sessionStorage`.
- `src/features/versions/upload-store.ts` persists only the versioned
  `showCompleted` preference. It explicitly never hydrates files or upload
  lifecycle data. Closing and reopening a draft dialog on the same mounted
  versions page may reuse its live in-memory session, but a full reload loses
  the browser `File` handles and requires the user to reselect the intended
  complete source folder before the draft can resume.
- `src/lib/i18n/i18n.tsx` may persist an anonymous locale in `localStorage`;
  authenticated locale changes are saved through the profile API and reflected
  in session/query/store state.

The locale fallback is Simplified Chinese (`zh-CN`) and English is the other
supported catalog. For an authenticated account, `admin_metadata.locale` is
authoritative; browser storage must not override the session/profile value.

Storage reads are browser-guarded, validated from `unknown`, and best-effort.
Blocked or corrupt storage falls back to safe in-memory defaults.

## Avoided and Forbidden Patterns

- Do not copy query data into local signals or a TanStack Store; TanStack Query
  remains the server-cache owner.
- Do not keep shareable page/filter/dialog state only in component signals.
- Do not make transient form fields or one-component flags global.
- Do not recompute `openedTabs` from only the current pathname or reset the tab
  list during navigation.
- Never persist credentials, OSS object secrets, `File` objects, multipart
  checkpoints, raw errors, or upload workflow state in browser storage.
- Do not create a process-wide upload singleton. Upload sessions are scoped to
  the versions-page owner and disposed with it.
- Do not mutate arrays, sets, or cached DTOs in place. Create a new value, as in
  `src/features/versions/versions-page.tsx`,
  `src/features/versions/cache.ts`, and `src/features/shell/ui-store.ts`.
