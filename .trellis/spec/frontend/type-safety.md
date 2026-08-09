# Type Safety

> TypeScript and runtime-boundary conventions for frontend code.

## Compiler Baseline

`tsconfig.json` enables strict TypeScript, `noUnusedLocals`,
`noUnusedParameters`, `noFallthroughCasesInSwitch`,
`noUncheckedSideEffectImports`, `verbatimModuleSyntax`, and `noEmit`. JSX uses
Solid's `jsxImportSource`. Keep `import type` separate for type-only imports,
matching `src/components/ui/button.tsx`, `src/features/programs/queries.ts`, and
`src/routes/_authenticated.tsx`.

## Type Organization

- Cross-layer wire contracts live in `src/shared/api/`, not in route or
  component files. `src/shared/api/common.ts` defines `Page`, `ApiProblem`,
  `EntityResult`, and `WeakEntityTag`; `src/shared/api/programs.ts` and
  `src/shared/api/versions.ts` define domain DTOs/search.
- Component-only contracts stay beside the component. Examples are
  `ProgramTableProps` in `src/features/programs/program-table.tsx`,
  `PaginationProps` in `src/components/ui/pagination.tsx`, and
  `ReleaseTrendChartProps` in
  `src/features/monitoring/release-trend-chart.tsx`.
- Feature navigation/search types stay in each feature's precise `search.ts`
  file and use discriminated
  unions to make invalid combinations unrepresentable. See
  `src/features/programs/search.ts`, `src/features/versions/search.ts`, and
  `src/features/administrators/search.ts`.
- Query keys are typed `as const` and normalized centrally in
  `src/lib/api/query-keys.ts`; route registration is checked with `satisfies`
  in `src/features/shell/route-registry.ts`; catalog coverage is checked in
  `src/lib/i18n/catalogs.ts`.

Interfaces and data properties are `readonly` by default. Inputs use readonly
arrays and precise callbacks, as shown by `ProgramTableProps`,
`UploadQueueController`, and the shared `Page<T>` contract.

## Literal and Domain Types

Derive unions from literal tuples instead of duplicating string unions:

- `PROGRAM_SORTS`/`PROGRAM_PAGE_SIZES` in `src/shared/api/programs.ts`.
- `VERSION_LIFECYCLE_STATUSES` in `src/shared/api/versions.ts`.
- `SUPPORTED_LOCALES` and the template-literal `WeakEntityTag` in
  `src/shared/api/common.ts`.

Use template-literal paths to constrain the API surface. `ApiPath` in
`src/lib/api/client.ts` and the return type of `programPath` in
`src/features/programs/api.ts` are the established examples. Use the shared
`UPDATER_IF_MATCH_HEADER`; never spell an alternative concurrency header in a
feature module.

## Runtime Boundaries

Treat URL search, persisted JSON, transport/error metadata, and third-party
events as `unknown` until narrowed. Successful API DTO bodies are the deliberate
compile-time-contract exception described below; do not imply that generic
`apiClient.json<T>` performs schema validation.

Examples:

- `src/features/programs/search.ts`, `src/features/versions/search.ts`, and
  `src/features/monitoring/search.ts` validate route search values and apply
  bounded defaults.
- `src/features/shell/ui-store.ts` parses and validates every persisted field
  before hydration; `src/features/versions/upload-store.ts` persists only a
  validated boolean preference.
- `src/lib/api/client.ts` bounds JSON/error body sizes, validates Problem Details
  and ETags, and rejects unsafe same-origin paths. Its generic success body is
  typed by the shared API contract rather than validated field-by-field.
- `src/features/shell/route-registry.ts` canonicalizes internal hrefs before
  using them for navigation or `returnTo`.

Use small type guards (`value is T`) and canonicalization functions rather than
casting arbitrary data. Examples include `isCanonicalUuid` in
`src/features/programs/search.ts`, `isSupportedLocale` in
`src/lib/i18n/catalogs.ts`, and `isProtectedRouteHref` in
`src/features/shell/route-registry.ts`.

Successful JSON DTOs currently rely on the typed API contract after the shared
client validates the transport envelope; do not claim they have schema-level
runtime validation. Add boundary validation deliberately if a new untrusted
consumer requires it.

## Solid and Router Typing

- Use `Accessor<T>` for values that must remain reactive across component
  boundaries (`ProgramsPageProps.search`, `VersionsPageProps.search`, and
  `I18nContextValue.locale`).
- Use route-local APIs such as `Route.useSearch`, `Route.useParams`, and
  `useNavigate({ from: Route.fullPath })`; examples are the program list,
  version list, and audit routes.
- Keep the TanStack Router `Register` augmentation in `src/router.tsx` so links,
  params, and searches infer from the generated route tree.
- Type DOM wrappers with `ComponentProps<"button">` or the Kobalte component
  type and forward native props, as in `src/components/ui/button.tsx`,
  `src/components/ui/input.tsx`, and `src/components/ui/dialog.tsx`.

## Avoided and Forbidden Patterns

- Do not add `any`, `@ts-ignore`, broad double assertions, or unvalidated casts
  to production frontend code. The `as any` values in
  `src/routeTree.gen.ts` are generated and are not a pattern to copy.
- Use `as const`/`satisfies` to preserve or verify literals; do not use an
  assertion to silence a domain mismatch.
- Keep unavoidable third-party adapter casts isolated and tested. Current
  exceptions are narrow boundaries such as
  `src/features/versions/oss-uploader.client.ts`,
  `src/features/versions/hash-worker.ts`, and `src/lib/sentry.client.ts`.
- Do not duplicate DTO shapes locally, use mutable arrays where a readonly
  contract works, or accept plain `string` when a bounded domain union exists.
- Do not assume parsed JSON, storage, route search, external URLs, or API error
  details match a TypeScript interface without a runtime check.
- Do not manually edit or use the generated route tree's casts as application
  types.
