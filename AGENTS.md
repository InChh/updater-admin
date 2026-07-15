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

This repository is the implemented replacement Updater administration system. The user approved the detailed requirements design on 2026-07-14. Batches 0–14 of the indexed plan are represented on `codex/updater-admin-implementation`; preserve the plan's ownership boundaries, compatibility exclusions, concurrency contracts, and release verification gates when maintaining it.

Preserve the generated TanStack Start structure unless an approved design gives a concrete reason to change it. Batch 14 retired the generated demonstrations after every requested TanStack library gained a production owner. The authenticated shell, Better Auth/Neon connection, Elysia API, Drizzle schema, direct OSS upload workflow, localization, dynamic tabs, settings, administration, monitoring, and audit surfaces are production-owned now.

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
- `2026-07-14 — Program-management contract`: program lists accept pages `1..1,000,000`, page sizes `20`, `50`, or `100`, case-sensitive literal substring name filters, and stable `createdAt` plus `id` sorting. Program mutations use opaque weak ETags and `If-Match`; successful delete returns `204` without a response ETag. Name and description limits are measured in Unicode code points, and validation paths are bounded, control-free, and well-formed Unicode.
- `2026-07-14 — Upload/storage`: preserve direct browser-to-Aliyun OSS upload with short-lived STS credentials. Support folder selection, relative paths, SHA-256, byte size, MIME type, per-file progress, retry, and idempotent metadata registration. Do not proxy release files through Netlify Functions.
- `2026-07-15 — Upload proof/security (supersedes the earlier 5 TiB limit)`: cap each browser release file at exactly 41,943,040,000 bytes, matching 10,000 explicit 4 MiB multipart parts. Use two in-flight parts per file and at most four files so raw part payloads remain bounded to 32 MiB before SDK/browser overhead. Keep object keys within the OSS limit of 1,023 UTF-8 bytes. Browser STS receives prefix-scoped `PutObject`, `AbortMultipartUpload`, and `ListParts` only; the permanent server principal separately receives prefix-scoped `GetObject` for metadata HEAD verification and never crosses the browser boundary.
- `2026-07-15 — OSS deployment security`: `x-oss-forbid-overwrite` is defense-in-depth because the browser controls its requests. Production must enable an OSS bucket-level no-overwrite rule for the dedicated upload prefix with bucket versioning disabled, plus a prefix-scoped lifecycle rule that removes incomplete multipart uploads after a short bounded period. Neither rule deletes completed release objects.
- `2026-07-15 — Upload completion envelope`: folder selection and STS authorization support up to 1,000 files, but browser completion is split into ordered batches of 25 for bounded Netlify HEAD verification. Completion also has a two-request per-actor instance cap and a Neon-backed 2,000-file-token budget per actor per 15 minutes. Missing-object reconciliation uses the distinct `UPLOAD_OBJECT_NOT_FOUND` / `OBJECT_NOT_FOUND` contract; metadata or canonical-key conflicts must never trigger another upload.
- `2026-07-14 — Upload state/audit`: canonical lock order prevents reversed-batch deadlocks while caller response order is preserved. Credential issuance is a security-sensitive success audit containing only file count and request context; completion success remains atomic with metadata registration. `File` and multipart checkpoint values remain memory-only, and sessionStorage contains only non-sensitive serializable UI preferences.
- `2026-07-14 — Deletion/audit/concurrency`: soft-delete business records, record actor and before/after audit data, never automatically delete OSS objects, and reject stale mutations with optimistic concurrency versions. Program deletion soft-deletes its live versions while preserving file metadata, version-file history, and OSS objects.
- `2026-07-14 — Audit ownership exception`: repositories append successful program-operation audits inside the same transaction as the mutation so state and success evidence remain atomic. The Elysia audit plugin owns redacted failure intents; failure-audit persistence or reporting errors never replace or mask the original API response.
- `2026-07-14 — Version format`: accept only canonical numeric `major.minor.patch` values with no leading zeros. Values remain numerically unique per program. Multiple versions may remain active; latest means the numerically highest active version.
- `2026-07-14 — Version-management contract`: version and nested-file lists use pages `1..1,000,000`, page sizes `20`, `50`, or `100`, stable whitelisted sorting, and metadata-only file DTOs. New versions start inactive and require at least one existing file ID. Renumbering must exceed every historical version, including soft-deleted rows and the row itself; an exact duplicate of another live version reports `VERSION_NUMBER_CONFLICT` before the historical monotonicity error. Omitted `fileIds` preserves relations, while `[]` explicitly removes all relations.
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
- `SENTRY_DSN`, `SENTRY_ENVIRONMENT`: optional server capture pair. `COMMIT_REF` is the Netlify release; `SENTRY_RELEASE` is the local fallback.
- `SENTRY_AUTH_TOKEN`, `SENTRY_ORG`, `SENTRY_PROJECT`: optional all-or-nothing build-time source-map upload group.
- `APP_VERSION`: optional release label shown on authenticated monitoring. Netlify supplies `DEPLOY_ID`, `COMMIT_REF`, and `CONTEXT` for the other build metadata fields.
- `OSS_ACCESS_KEY_ID`, `OSS_ACCESS_KEY_SECRET`, `OSS_UPLOAD_RAM_ROLE_ARN`, `OSS_STS_ENDPOINT`: server-only variables for upload STS issuance and upload verification. Download STS is outside this administration project.
- `OSS_BUCKET`, `OSS_REGION`, `OSS_UPLOAD_PREFIX`: object-storage target and the namespace allowed by upload STS policy.
- `TEST_DATABASE_URL`: disposable migrated Neon branch used only by destructive/transactional database verification; never point this at shared or production data.
- `TEST_DATABASE_CONFIRM_DISPOSABLE`: must equal the exact sentinel `updater-admin-destructive-tests` before any destructive database suite can connect, migrate, or truncate.
- `E2E_ADMIN_EMAIL`, `E2E_ADMIN_PASSWORD`: seeded test administrator used by authenticated Playwright suites. Anonymous guard coverage runs without them; authenticated suites explicitly skip when they are absent.
- `E2E_PORT`: optional Playwright-only loopback port override. The harness defaults to `3187`, starts Vite directly with `strictPort`, and deliberately refuses to reuse an existing server so another local application's `/health` endpoint cannot produce false browser results.

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

For this project, a user-requested E2E acceptance pass means starting the real
full-stack application against a disposable Postgres database and operating it
through the Codex in-app browser: navigate, click, submit forms, reload, and
inspect the resulting UI state. `pnpm test:e2e` remains useful regression
coverage, but it is not a substitute for that manual browser acceptance pass.

Biome uses the installed `2.4.5` schema with Tailwind directive parsing. `src/routeTree.gen.ts` is generated and excluded from formatting. The final local matrix on 2026-07-15 passed frozen offline install, route generation, Intent discovery (10 packages/31 skills), TanStack CLI library discovery (16 libraries), Biome over 279 files, TypeScript, 98 Vitest files/568 tests, Drizzle schema check, the Netlify client/SSR build, built-function `/health` smoke with all four dynamic security headers, route/client-secret/source-map scans, and diff-check. Playwright passed 8 public desktop/mobile tests and explicitly skipped 18 credential-gated authenticated tests. `pnpm test:db` loaded 6 files/6 tests and explicitly skipped them because no disposable `TEST_DATABASE_URL` was authorized. Live OSS, Sentry, and Netlify Preview verification also remain external gates rather than implied passes.

## Netlify deployment

Netlify builds with `pnpm build`, publishes `dist/client`, and uses the generated TanStack Start adapter for server functions. Run `pnpm deploy:prepare` against the target Neon branch before a migration-bearing deploy; request startup never runs migrations. Set the canonical HTTPS site origin as `BETTER_AUTH_URL`, keep release binaries in OSS rather than the deploy artifact, and bootstrap the first administrator once after migration. `netlify.toml` covers static-file security headers, while `src/start.ts` applies the same policy to SSR/function responses because Netlify custom headers do not cover those dynamic responses.

## Known gotchas

- Password rotation spans Better Auth credential/session storage and the Drizzle-owned `admin_metadata` policy row, so it cannot be one database transaction without replacing a library owner. The API compensates by marking `mustChangePassword=true` after a successful credential change and before revocation; surviving sessions then fail closed on their next uncached metadata read. If that marker write fails, session revocation is attempted best-effort, but simultaneous Better Auth and database outages remain an unavoidable cross-library partial-success boundary.
- The exact requested CLI add-on list cannot currently resolve for Solid (`neon`, `drizzle`, and `shadcn` are not registered under those names); this is why official packages plus `solid-ui` are used.
- The requested Solid `saas` starter was not resolvable without a configured template registry. This repository therefore preserves the current default Solid Start scaffold and will adopt a SaaS module layout only after design approval.
- The CLI's automatic Intent install did not complete, so the two required `npx @tanstack/intent@latest` commands were run manually afterward.
- `tanstack pin-versions` in CLI `0.69.5` assumes a React Start dependency and does not work for this Solid scaffold; keep dependency changes intentional and verify with typecheck/build.
- Intent currently detects both `@tanstack/devtools-event-client` `0.5.0` and transitive `0.4.4`, selecting `0.5.0`. The scaffold builds successfully, but recheck the warning after dependency upgrades.
- Intent `0.3.5` uses the explicit ten-package `intent.skills` allowlist in `package.json`; update that allowlist intentionally when TanStack packages change.
- In this workspace, `pnpm dlx @tanstack/intent@latest load ...` can fail against the restricted package registry even though Intent is installed locally. Use `pnpm exec intent load ...` as the no-download equivalent and still record the exact skill loaded.
- Local `npx` may need a writable temporary npm cache on this machine because `~/.npm` contains root-owned entries.
- Business leaf routes deliberately use `ssr: false`; the pathless authenticated guard remains SSR-capable. Browser loaders call same-origin Elysia through Query, avoiding a duplicate cookie-forwarding adapter.
- `/programs/$programId/versions` is structurally nested under `/programs`. Batch 6 resolved the route ownership by making `programs.tsx` the `<Outlet />` layout and `programs.index.tsx` the list leaf; preserve this split so the version child is not hidden or stacked.
- Program list ordering is deterministic: filter with a literal, case-sensitive substring and sort by `createdAt` plus `id`. Keep page values bounded to `1..1,000,000` and page sizes to `20`, `50`, or `100` in shared contracts, routes, domain logic, and API schemas.
- Program validation counts Unicode code points rather than UTF-16 code units. Database-bound text rejects NUL and ill-formed surrogate sequences, while Problem Details validation paths remain bounded, control-free, and well-formed so the browser client can safely accept them.
- Program deletion intentionally preserves `file_metadata`, `version_files`, and Aliyun OSS objects while soft-deleting the program and its live versions. Do not add object cleanup to this mutation.
- Successful program audits are an intentional repository ownership exception because they must commit atomically with the mutation. Redacted failure audit intent stays in the API plugin, and any audit failure must leave the original error response unchanged.
- Version creation and renumbering lock the live parent program. Check an exact duplicate of another live row before enforcing the all-history maximum so `VERSION_NUMBER_CONFLICT` remains reachable; the historical maximum intentionally includes soft-deleted rows and the row being renumbered.
- Version-file replacement is tri-state: omitted `fileIds` preserves the existing relation set, `[]` removes it, and a non-empty list validates every live file before replacement. Keep full before/after ID sets in the atomic success audit.
- Aliyun OSS object-key length is measured in UTF-8 bytes, not JavaScript string length. Validate every deterministic destination before requesting STS so an invalid folder cannot consume credentials. Keep server metadata verification permission on the permanent RAM principal and out of the temporary browser policy.
- Every multipart request sets `x-oss-forbid-overwrite: true`. Deterministic names are not sufficient overwrite protection because the server verifies size/ETag rather than downloading and rehashing large objects; never remove the header without replacing that integrity boundary.
- Upload completion transactions acquire file identities in canonical `(path, sha256, size)` order and restore caller order in the response. Preserve that invariant when changing batch registration or uniqueness rules.
- Browser upload code must continue hashing bounded 4 MiB slices rather than calling whole-file `arrayBuffer()`. Do not persist `File`, credentials, object ETags, or ali-oss checkpoints to web storage.
- The authenticated locale is server-owned by `admin_metadata.locale`; profile and top-bar changes persist through the Elysia profile mutation and refresh the Query-owned session projection. Do not reintroduce a localStorage override that can beat the server profile.
- Program-version tabs use the program name once Query resolves it while preserving the concrete href and program-scoped key; the ID prefix remains only the loading fallback.
- `admin_metadata.row_version` is an optimistic-concurrency token for administrator/profile policy mutations; Better Auth remains the identity/password/session/disabled-state owner. Do not copy those fields into another table owner.
- Monitoring readiness intentionally degrades individual Neon/OSS sections and caches/coalesces provider probes briefly; `/health` remains minimal and unauthenticated.
- Browser Sentry stays behind a TanStack `createClientOnlyFn` boundary and must not dynamically import the SDK when `VITE_SENTRY_DSN` is empty. Server capture performs a bounded flush so Netlify does not freeze queued events before delivery.
- Keep `zod` 4.x as a direct production dependency. The generated Netlify server leaves Better Auth's Zod import external; relying only on the transitive dependency can resolve an incompatible ancestor installation and crash before `/health` is served.
- Playwright must own its loopback listener. Do not enable `reuseExistingServer`: a foreign application on a common port can satisfy the readiness URL while serving the wrong `/health` and routes. Use the isolated default `3187` or set a validated `E2E_PORT` override.
- This managed workspace rejects local socket binding with `listen EPERM`. The Devtools Vite plugin can make that rejection look like a startup hang; use the built Netlify handler smoke here and run Playwright/local HTTP smoke in a host that permits loopback listeners. The scaffold currently uses Vite 8 while the installed Devtools package advertises Vite 6/7 peer support, so recheck the pairing on upgrades.

## Current implementation sequence

1. Keep migrations, shared DTOs, Elysia modules, Query keys, and UI mutations aligned when changing a vertical slice.
2. Rerun the full static/unit/DB/E2E/build/route/secret matrix before release; treat missing disposable DB, seeded E2E, OSS sandbox, or Netlify Preview credentials as explicit external gates rather than silent passes.
3. Complete the documented Neon, OSS, Sentry, Netlify, bootstrap, and authorized Preview steps for each environment before production traffic.

The rationale for the single-deployment transport boundary is recorded in `docs/aegis/adr/ADR-0001-same-origin-start-elysia-boundary.md`: TanStack Start remains the thin same-origin Netlify transport while Elysia remains the canonical business API and authorization owner.
