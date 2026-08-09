# Component Guidelines

> How Solid components are built in this project.

## Component Shape

Reusable feature and shared UI components are named functions. Domain and
non-trivial component contracts are explicit interfaces with `readonly`
fields. Transparent native wrappers may accept `ComponentProps<...>` directly,
as `src/components/ui/input.tsx`, `src/components/ui/textarea.tsx`, and the
header/footer helpers in `src/components/ui/dialog.tsx` do; Kobalte composition
parts are re-exported as named aliases.
The codebase does not use React component types or class components. Route
adapters and private subcomponents remain named, non-exported functions, as
shown by
`src/routes/_authenticated/programs.index.tsx`,
`src/routes/_authenticated/monitoring.audit.tsx`, and
`src/features/shell/topbar.tsx`.

Examples:

- `src/components/ui/button.tsx` exports `Button(props: ButtonProps)` and extends
  `ComponentProps<"button">` for native attributes.
- `src/features/programs/program-table.tsx` declares a domain-specific,
  callback-driven `ProgramTableProps` interface.
- `src/features/monitoring/release-trend-chart.tsx` keeps SVG computation and
  its small `ReleaseTrendChartProps` contract in one focused component.

Keep local signals/memos/effects before event handlers and return markup last,
matching `src/features/programs/programs-page.tsx`,
`src/features/versions/versions-page.tsx`, and
`src/features/shell/app-shell.tsx`.

## Props and Reactivity

- Read reactive props through `props`; do not destructure them at component
  entry. Solid tracks property reads, not a copied local value.
- Pass an `Accessor<T>` when a child must react to a route or owner value over
  time. `ProgramsPageProps.search`, `VersionsPageProps.search`, and
  `VersionsPageProps.program` are current examples.
- Use `readonly` arrays and callback contracts. Examples include
  `PaginationProps.pageSizeOptions`, `OpenedTabsProps.tabs`, and
  `UploadQueueProps.controller`/callbacks.
- For native-wrapper primitives, use `ComponentProps<...>` plus `splitProps`
  and forward the remaining attributes. `src/components/ui/button.tsx`,
  `src/components/ui/dialog.tsx`, and `src/components/ui/dropdown-menu.tsx`
  demonstrate this pattern.
- Use render props or JSX slots for composition when the child must supply
  behavior. `src/components/ui/field.tsx` supplies linked ARIA props,
  `src/components/ui/table-shell.tsx` accepts toolbar/footer slots, and
  `src/components/ui/dialog.tsx` re-exports Kobalte composition parts.

Do not eagerly invoke a render prop on every reactive update when doing so
would replace an input. `src/components/ui/field.tsx` resolves its control once
so typing and validation do not drop keyboard focus; this is covered by
`src/components/ui/field.test.tsx` and
`tests/e2e/responsive-accessibility.spec.ts`.

## Forms and Events

- Validated data-entry forms use `@tanstack/solid-form`, controlled values, and
  both client and server error display. See
  `src/features/programs/program-form.tsx`,
  `src/features/settings/system-form.tsx`, and
  `src/features/auth/login-form.tsx`. Simple URL-backed search/filter forms are
  the intentional native-form exception: `src/features/programs/programs-page.tsx`,
  `src/features/administrators/administrators-page.tsx`, and
  `src/features/monitoring/audit-page.tsx` keep their small drafts in signals,
  prevent native submission, and commit canonical Router search state.
- Native events read `event.currentTarget`, which preserves the typed element;
  examples appear in `src/features/programs/program-form.tsx`,
  `src/components/ui/pagination.tsx`, and
  `src/features/versions/folder-picker.tsx`.
- Prevent native submit navigation and deliberately discard promises with
  `void` from synchronous handlers. See
  `src/features/programs/program-form.tsx`,
  `src/features/auth/change-password-form.tsx`, and
  `src/features/programs/programs-page.tsx`.
- Pending state disables duplicate actions and is reflected with `aria-busy`
  or status copy. See `src/features/programs/program-form.tsx`,
  `src/features/administrators/administrator-form.tsx`, and
  `src/features/versions/version-form.tsx`.
- Preserve the login form's native-safety guard in
  `src/features/auth/login-form.tsx`: it remains `method="post"`, always
  prevents the native submit after hydration, and disables its submit button
  until `useHydrated()` is true. This prevents an unusually early native
  submission from serializing credentials into the URL before Solid owns the
  handler.

## Styling and Localization

- Use Tailwind utility classes inline for component layout and states. Merge
  caller classes with `cn()` in reusable primitives such as
  `src/components/ui/button.tsx`, `src/components/ui/input.tsx`, and
  `src/components/ui/table-shell.tsx`.
- Use Solid `classList` for reactive classes, as in
  `src/components/ui/pagination.tsx`, `src/features/programs/programs-page.tsx`,
  and `src/features/shell/tabs.tsx`. The sidebar instead uses TanStack Router's
  `activeProps` for route-active classes and a reactive `style` width.
- Put design tokens and genuinely global helpers in `src/styles.css` (`@theme`,
  `.panel`, `.data-text`, `.focus-ring`); do not add a feature stylesheet for
  ordinary utility composition.
- Page and dialog copy comes from `useI18n()` or is passed into a leaf control
  through a localized labels contract. Examples include
  `src/features/programs/programs-page.tsx`,
  `src/features/monitoring/audit-page.tsx`, and
  `src/features/shell/topbar.tsx`. Keep catalog keys aligned in
  `src/lib/i18n/catalogs.ts`. `src/features/versions/folder-picker.tsx` has
  isolated fallback labels, but its production owner in
  `src/features/versions/version-form.tsx` supplies `props.labels.folderPicker`.
  The language-switch autonyms in
  `src/routes/login.tsx` and the static title in `src/routes/__root.tsx` are
  explicit bootstrap exceptions, not a pattern for feature copy.
- The current production theme is the light green administration theme defined
  by `src/styles.css`. Keep its responsive layout, keyboard behavior, and
  reduced-motion override. Do not introduce an unowned dark-mode branch merely
  because the scaffold `.cursorrules` mentions one.

## Accessibility

- Prefer native elements and Kobalte primitives. `src/components/ui/dialog.tsx`,
  `src/components/ui/dropdown-menu.tsx`, and
  `src/components/ui/tooltip.tsx` rely on Kobalte for interaction and
  focus semantics.
- Every icon-only button needs a localized accessible name, while decorative
  icons use `aria-hidden="true"`. See
  `src/features/programs/program-table.tsx`,
  `src/components/ui/pagination.tsx`, and `src/features/shell/topbar.tsx`.
- Associate fields, help, errors, and required state through `Field`; use
  `role="alert"` for actionable failures. See `src/components/ui/field.tsx`,
  `src/features/programs/program-form.tsx`, and
  `src/features/settings/system-page.tsx`.
- Tables need a caption and scoped headers; sortable columns expose
  `aria-sort`. See `src/features/programs/program-table.tsx`,
  `src/features/versions/version-table.tsx`, and
  `src/features/monitoring/audit-table.tsx`.
- Complex graphics require an equivalent text/table representation.
  `src/features/monitoring/release-trend-chart.tsx` supplies an SVG title and
  description plus an accessible details table.
- Preserve focus after dialogs and navigation.
  `src/features/programs/programs-page.tsx`,
  `src/features/versions/versions-page.tsx`, and
  `src/features/shell/app-shell.tsx` contain the established patterns.

## Avoided and Forbidden Patterns

- Do not use React APIs, class components, or destructured reactive props.
- Do not use clickable `div`/`span` elements in place of buttons or links.
- Do not render raw API `detail` strings to users; use
  `useI18n().formatApiError`, as in
  `src/features/programs/programs-page.tsx`,
  `src/features/settings/system-page.tsx`, and
  `src/features/versions/version-dialogs.client.tsx`.
- Do not add hardcoded one-language copy to pages or dialogs, or non-localized
  `aria-label` values; pass localized labels into reusable leaf controls.
- Do not put browser-only OSS/File/Worker behavior into an SSR path. Enter the
  upload subtree through the isomorphic
  `src/features/versions/version-dialogs.tsx` boundary, which loads
  `src/features/versions/version-dialogs.client.tsx` only after hydration;
  `src/features/versions/oss-uploader.client.ts` and
  `src/features/versions/upload-workflow.client.ts` are its standalone
  client integration modules.
- Do not add animation without retaining the reduced-motion override in
  `src/styles.css`.
