<!-- intent-skills:start -->
## Skill Loading

Before editing files for a substantial task:
- Run `pnpm dlx @tanstack/intent@latest list` from the workspace root to see available local skills.
- If a listed skill matches the task, run `pnpm dlx @tanstack/intent@latest load <package>#<skill>` before changing files.
- Use the loaded `SKILL.md` guidance while making the change.
- Monorepos: when working across packages, run the skill check from the workspace root and prefer the local skill for the package being changed.
- Multiple matches: prefer the most specific local skill for the package or concern you are changing; load additional skills only when the task spans multiple packages or concerns.
<!-- intent-skills:end -->

# Updater Admin project context

## Current phase and hard gate

This repository is the active implementation of the replacement Updater administration system. The user approved the detailed requirements design on 2026-07-14. Batches 0–5 of the indexed plan are complete on `codex/updater-admin-implementation`; Batch 6 program management is the active slice. Continue to preserve the plan's vertical-slice order, ownership boundaries, compatibility exclusions, and verification gates.

Preserve the generated TanStack Start structure unless an approved design gives a concrete reason to change it. Generated `demo.*` routes still prove integrations that do not yet have production owners and are retired together in Batch 14. The authenticated shell, Better Auth/Neon connection, Elysia foundation, database schema, localization, and dynamic tabs are production-owned now.

## Scaffold provenance

The user-requested command was executed first, unchanged:

```bash
npx @tanstack/cli@latest create updater-admin --agent --package-manager pnpm --tailwind --deployment netlify --add-ons neon,form,sentry,shadcn,tanstack-query,better-auth,drizzle
```

TanStack CLI `0.69.5` rejected it because the current Solid add-on registry has no `neon` add-on. The initial run also encountered a root-owned `~/.npm` cache, so subsequent `npx` commands used a temporary writable npm cache. A separate `--template-id saas` probe also failed because no template registry was configured for a resolvable Solid SaaS template.

The compatible scaffold that produced this repository was:

```bash
npx @tanstack/cli@latest create updater-admin --framework Solid --package-manager pnpm --tailwind --toolchain biome --deployment netlify --add-ons form,sentry,solid-ui,tanstack-query,better-auth,store --examples --intent --git -y
```

`solid-ui` is the Solid-compatible shadcn-style component integration exposed by the current CLI; the React-oriented `shadcn` add-on is not exposed for Solid. Neon and Drizzle were then represented with their official packages because neither is currently a Solid CLI add-on. Elysia and TanStack Table were also added as dependencies, without starting business implementation.

The required TanStack Intent follow-up commands were run from this repository:

```bash
npx @tanstack/intent@latest install
npx @tanstack/intent@latest list
```

Before architecture- or library-specific edits, run `pnpm intent:list`, load the most specific matching package skill, and follow its shipped guidance. The initial scaffold used the installed Start, Solid Start, deployment, Router, data-loading, and auth/guard guidance.

## Chosen stack and represented integrations

- Runtime/UI: Solid, TanStack Start, TanStack Router, Tailwind CSS 4, Solid-UI.
- Data and state: TanStack Query, TanStack Table, TanStack Form, TanStack Store.
- Backend target: Elysia mounted under same-origin `/api/*` in the TanStack Start Netlify deployment.
- Persistence target: a fresh, single-tenant Neon Postgres database through Drizzle ORM; no legacy business data is imported.
- Auth: a new Better Auth account store with email/password login, no public registration, and one full-access administrator permission level.
- Monitoring: application health, Neon/OSS readiness, audit activity, and chart-ready release metrics on the monitoring page; Sentry handles error capture without importing Sentry issues into the administration UI.
- Deployment: Netlify adapter and `netlify.toml` are present. SSR/server routes are expected to run as Netlify Functions.
- Tooling: pnpm, Biome, TypeScript, Vitest, TanStack CLI, and TanStack Intent.
- Billing, multi-tenancy, and a Dashboard page are explicitly out of scope. Monitoring data contracts remain renderer-neutral and chart-ready.

TanStack Query uses the generated router integration with `defaultPreloadStaleTime: 0`, so Query remains the cache owner. Secrets and database access must stay in server-only Elysia/server-route code, never in browser bundles or isomorphic route loaders.

## Existing UpdaterServer migration baseline

The source system is `/Users/bytedance/prog/UpdaterServer` (currently inspected at commit `277b28e`). Its 23 repository-owned application/version/file/STS endpoints are an inventory of source business behavior, not a compatibility contract. The new Elysia API uses redesigned `/api/v1/*` routes, DTOs, pagination, authentication boundaries, and errors for this administration UI. ABP-provided account, identity, role, permission, settings, feature, bootstrap, and OpenIddict protocol endpoints remain out of scope.

The existing upload model obtains Aliyun OSS STS credentials and uploads directly from the browser. Avoid proxying large release artifacts through Netlify Functions unless the approved design explicitly changes that model. The accepted version rule permits multiple active versions and marks the highest active semantic version as latest.

## Approved requirements decisions

- `2026-07-14 — API migration scope (supersedes the earlier parity choice)`: migrate the administration system's program/version/file/STS business capabilities into Elysia, using UpdaterServer only as a semantic reference. Do not reproduce its 23 routes one-for-one. Do not reimplement the package-provided ABP account/identity/role/permission/settings/features/bootstrap APIs or the OpenIddict `/connect/*` protocol surface.
- `2026-07-13 — Admin accounts (Option A)`: create a new Better Auth account store in Neon. Public registration is disabled. Bootstrap the first administrator from one-time environment values; authenticated administrators create additional accounts with temporary passwords that must be changed at first login. Do not import ABP users, password hashes, sessions, or tokens.
- `2026-07-13 — Business data (Option C)`: start with a new empty Neon business database and do not import existing applications, versions, file metadata, or version-file relations. Do not delete or mutate the legacy database or existing OSS objects as part of the new-system setup.
- `2026-07-14 — Client boundary (clarified)`: existing updater clients and their anonymous latest-version, manifest, file-URL, and download-STS contracts are not part of this administration-system project. Do not build or test an UpdaterServer client-compatibility layer.
- `2026-07-13 — Authorization roles (Option B)`: every authenticated Better Auth account has the same full administrator permissions. Do not add Owner/Admin/Viewer RBAC or per-action permission tables. All authenticated administrators can manage programs, versions, uploads, settings, and administrator accounts.
- `2026-07-13 — Version activation (Option B)`: allow multiple versions of the same program to be active simultaneously. The latest version is the highest active semantic version, matching the current UpdaterServer behavior and the provided screenshots. Enabling or disabling one version must not implicitly change any other version.
- `2026-07-14 — Product scope`: the application is single-tenant and has no Billing feature. Do not create billing routes, provider adapters, subscription tables, pricing UI, invoice placeholders, or organization/tenant abstractions.
- `2026-07-14 — Deployment topology`: keep one repository and one Netlify deployment. Better Auth remains under `/api/auth/*`; TanStack Start server routes act only as transport adapters to the server-only Elysia `/api/v1/*` application and `/health`.
- `2026-07-14 — Frontend/backend contract`: redesign communication around `/api/v1/*`, camelCase DTOs, `{ items, page, pageSize, total }` lists, ETag/If-Match concurrency, and a compact Problem Details error model. Do not copy UpdaterServer paths, DTO envelopes, authentication markers, or `App:*` business error codes.
- `2026-07-14 — Upload/storage`: preserve direct browser-to-Aliyun OSS upload with short-lived STS credentials. Support folder selection, relative paths, SHA-256, byte size, MIME type, per-file progress, retry, and idempotent metadata registration. Do not proxy release files through Netlify Functions.
- `2026-07-14 — Deletion/audit/concurrency`: soft-delete business records, record actor and before/after audit data, never automatically delete OSS objects, and reject stale mutations with optimistic concurrency versions.
- `2026-07-14 — Version format`: accept only canonical numeric `major.minor.patch` values with no leading zeros. Values remain numerically unique per program. Multiple versions may remain active; latest means the numerically highest active version.
- `2026-07-14 — Initial pages and entry route`: login, programs, nested program versions, administrator accounts, monitoring, profile settings, and system settings. There is no Dashboard, overview, Billing, or tenant page. Login and `/` lead to `/programs` unless a valid protected return URL exists.
- `2026-07-14 — Dynamic tabs`: render the tab bar directly below the top toolbar and above the page title. `/programs` is pinned; other visited pages remain open across navigation via TanStack Store plus `sessionStorage`. Tabs are stateful opened-page history, not a projection of the current route. Closing the active tab falls back to the left neighbor or `/programs`.
- `2026-07-14 — Monitoring`: expose liveness plus authenticated Neon/OSS readiness, audit history, chart-ready release trends, active-version count, storage totals, and recent operations on monitoring routes. Send browser/server errors to Sentry, but do not fetch or duplicate Sentry Issue data.
- `2026-07-14 — Visual and localization`: closely match the supplied green desktop administration UI while adding responsive behavior, keyboard accessibility, and reduced-motion support. Default to Simplified Chinese, provide English, and persist locale per user.

## Detailed-design approval boundary

- Elysia is intended to become the canonical business API owner. Router loaders and TanStack Query should consume that API rather than owning database writes.
- API authorization must be enforced in Elysia/server routes; client route guards are navigation UX, not API security.
- Product decisions are captured above and expanded in `docs/aegis/specs/2026-07-14-updater-admin-design.md`. The user approved that document on 2026-07-14; implementation must follow `docs/aegis/plans/2026-07-14-updater-admin-implementation.md` once an execution mode is selected.
- Dashboard, legacy API/client compatibility, client rollout and cutover, legacy data migration, billing, multi-tenancy, ABP/OpenIddict platform APIs, Sentry Issue ingestion, and automatic OSS deletion are explicitly out of scope.

## Environment variables

Copy `.env.example` to `.env.local` for local work. Never commit real values.

- `DATABASE_URL`: Neon pooled Postgres connection string used by Drizzle and Better Auth after migrations are applied.
- `BETTER_AUTH_URL`: public application origin, `http://localhost:3000` locally and the canonical Netlify URL in production.
- `BETTER_AUTH_SECRET`: high-entropy secret generated with `pnpm dlx @better-auth/cli secret`.
- `BOOTSTRAP_ADMIN_NAME`, `BOOTSTRAP_ADMIN_EMAIL`, `BOOTSTRAP_ADMIN_PASSWORD`: one-time first-administrator values consumed by an idempotent bootstrap command and removed from the deployed environment after success.
- `VITE_SENTRY_DSN`: Sentry browser DSN; anything prefixed `VITE_` is public.
- `SENTRY_DSN`, `SENTRY_AUTH_TOKEN`, `SENTRY_ORG`, `SENTRY_PROJECT`, `SENTRY_ENVIRONMENT`: server capture and Netlify source-map upload configuration.
- `OSS_ACCESS_KEY_ID`, `OSS_ACCESS_KEY_SECRET`, `OSS_UPLOAD_RAM_ROLE_ARN`, `OSS_STS_ENDPOINT`: server-only variables for upload STS issuance and upload verification. Download STS is outside this administration project.
- `OSS_BUCKET`, `OSS_REGION`, `OSS_UPLOAD_PREFIX`: object-storage target and the namespace allowed by upload STS policy.
- `TEST_DATABASE_URL`: disposable migrated Neon branch used only by destructive/transactional database verification; never point this at shared or production data.
- `E2E_ADMIN_EMAIL`, `E2E_ADMIN_PASSWORD`: seeded test administrator used by authenticated Playwright suites. Anonymous guard coverage runs without them; authenticated suites explicitly skip when they are absent.

## Local commands and verification

```bash
pnpm install
pnpm dev
pnpm check
pnpm typecheck
pnpm test
pnpm test:db
pnpm test:e2e
pnpm build
pnpm intent:list
pnpm generate-routes
```

Biome uses the installed `2.4.5` schema with Tailwind directive parsing. `src/routeTree.gen.ts` is generated and excluded from formatting. After Batch 5, the local gate is 145 unit/contract/component tests plus an anonymous real-Router Playwright guard; the disposable-database and authenticated-browser portions remain credential-gated.

## Netlify deployment

Netlify builds with `pnpm build`, publishes `dist/client`, and uses the generated TanStack Start adapter for server functions. Set the production environment variables in Netlify, use the canonical site URL for `BETTER_AUTH_URL`, provision Neon separately, and run approved database migrations before serving authenticated traffic. Keep release binaries in object storage rather than the deploy artifact.

## Known gotchas

- Password rotation spans Better Auth credential/session storage and the Drizzle-owned `admin_metadata` policy row, so it cannot be one database transaction without replacing a library owner. The API compensates by marking `mustChangePassword=true` after a successful credential change and before revocation; surviving sessions then fail closed on their next uncached metadata read. If that marker write fails, session revocation is attempted best-effort, but simultaneous Better Auth and database outages remain an unavoidable cross-library partial-success boundary.
- The exact requested CLI add-on list cannot currently resolve for Solid (`neon`, `drizzle`, and `shadcn` are not registered under those names); this is why official packages plus `solid-ui` are used.
- The requested Solid `saas` starter was not resolvable without a configured template registry. This repository therefore preserves the current default Solid Start scaffold and will adopt a SaaS module layout only after design approval.
- The CLI's automatic Intent install did not complete, so the two required `npx @tanstack/intent@latest` commands were run manually afterward.
- `tanstack pin-versions` in CLI `0.69.5` assumes a React Start dependency and does not work for this Solid scaffold; keep dependency changes intentional and verify with typecheck/build.
- Intent currently detects both `@tanstack/devtools-event-client` `0.5.0` and transitive `0.4.4`, selecting `0.5.0`. The scaffold builds successfully, but recheck the warning after dependency upgrades.
- Intent `0.3.5` currently reports that `intent.skills` is unset and warns a future version will require an explicit package allowlist. The implementation plan adds the ten currently reviewed TanStack skill sources to `package.json` before business work.
- In this workspace, `pnpm dlx @tanstack/intent@latest load ...` can fail against the restricted package registry even though Intent is installed locally. Use `pnpm exec intent load ...` as the no-download equivalent and still record the exact skill loaded.
- Local `npx` may need a writable temporary npm cache on this machine because `~/.npm` contains root-owned entries.
- Business leaf routes deliberately use `ssr: false`; the pathless authenticated guard remains SSR-capable. Browser loaders call same-origin Elysia through Query, avoiding a duplicate cookie-forwarding adapter.
- `/programs/$programId/versions` is structurally nested under `/programs`. Batch 6 must turn `programs.tsx` into an `<Outlet />` layout and add `programs.index.tsx` for the list page so the version child is not hidden or stacked.
- The authenticated locale starts from server-owned `admin_metadata.locale`. Browser changes are session-local until Batch 10 adds the approved profile locale mutation; do not reintroduce a localStorage override that can beat the server profile.
- Program-version tabs intentionally show the program ID prefix until the program query exists; Batch 9 replaces it with the program name while preserving the concrete href and program-scoped key.

## Current implementation sequence

1. Implement Batch 6 program contracts, transactional repository/domain/API behavior, and Query/Table/Form UI, including the programs layout/index split.
2. Continue Batches 7–13 in dependency order, parallelizing non-overlapping backend, upload, account, settings, monitoring, and deployment slices.
3. In Batch 14 retire demos, run the complete DB/E2E/build/secret-scan matrix, compare against the supplied screenshots, and update this file with final cloud setup and remaining external actions.
