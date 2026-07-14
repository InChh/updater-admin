# Updater Admin Implementation Plan

> Aegis execution contract: implement this plan batch by batch, stop at every verification gate, and do not widen scope into legacy-client compatibility, Billing, multi-tenancy, cloud-resource creation, or production mutation.

**Goal:** Build the approved single-tenant version-management administration system on the generated Solid/TanStack Start scaffold, with Better Auth, a redesigned Elysia `/api/v1` backend, Drizzle/Neon persistence, direct Aliyun OSS uploads, monitoring, audit, Sentry, and Netlify deployment wiring.

**Architecture:** TanStack Start owns the Solid application shell and same-origin Netlify request entry. Better Auth remains the sole session owner under `/api/auth/*`. A thin Start catch-all forwards raw requests to a server-only Elysia app, which is the only business-contract, authorization, validation, transaction, and audit owner. Drizzle repositories are the only SQL owners. TanStack Query is the only remote-cache owner; Router, Table, Form, and Store retain their approved UI responsibilities.

**Tech Stack:** Solid 1.9, TanStack Start/Router/Query/Table/Form/Store/CLI/Intent, Tailwind CSS 4, Solid-UI/Kobalte primitives, Elysia 1.4, Better Auth 1.6, Drizzle ORM, Neon Postgres, Aliyun STS/OSS, Sentry, Netlify, pnpm, Biome, Vitest, Playwright.

**Baseline / Authority Refs:** `AGENTS.md`; `docs/aegis/specs/2026-07-14-updater-admin-design.md`; `docs/aegis/baseline/2026-07-14-initial-baseline.md`; `/Users/bytedance/prog/UpdaterServer` at commit `277b28e`; the eight supplied UI screenshots; locally installed TanStack Intent guidance.

**Compatibility Boundary:** This is a new administration API and a new empty database. It does not preserve UpdaterServer paths, DTOs, ABP envelopes, `App:*` error codes, OpenIddict endpoints, anonymous updater-client endpoints, legacy users, legacy data, or client rollout behavior. It never automatically deletes OSS objects.

**TDD Route:** Mode `off`; Decision `skipped`; Strict authority `not applicable`; Test posture `post-change regression`; Reason: the user did not request strict/test-first TDD; Verification: every batch adds focused unit, contract, integration, component, or E2E coverage before its completion gate.

**Verification:** `pnpm check`, `pnpm typecheck`, `pnpm test`, targeted database integration tests with `TEST_DATABASE_URL`, `pnpm test:e2e`, `pnpm build`, local Netlify-function smoke tests, and an authorized Netlify Preview smoke test before release.

## Aegis Visibility

- Aegis: Active.
- Requirement authority: approved design spec plus the user's corrections recorded in `AGENTS.md`.
- Baseline scope: both product and architecture.
- Risk class: high.
- Expected execution length: long.
- Contract/schema change: yes.
- External-state boundary: implementation and local/test verification are authorized after execution selection; provisioning Neon/OSS/Sentry/Netlify resources, changing production, or deploying publicly requires separate authority and credentials.

## Plan Basis

### Current state

- The CLI scaffold, integrations, package lock, Netlify adapter, Biome configuration, and Intent installation exist.
- The repository has no commits; all scaffold files are currently untracked on `main`.
- The scaffold currently builds, typechecks, and passes Biome, while Vitest passes only because `--passWithNoTests` is enabled.
- Intent currently surfaces ten local skill packages but warns that `intent.skills` is unset; it also reports the known `@tanstack/devtools-event-client` 0.5.0/0.4.4 transitive conflict and selects 0.5.0.
- `src/routes/__root.tsx` and `src/routes/index.tsx` still render scaffold/demo UI. Better Auth is not connected to Neon, Elysia is not mounted, Drizzle has no schema, and no business tests exist.
- TanStack Query already uses `defaultPreloadStaleTime: 0`, so Query remains the sole remote-cache owner.

### Package-shipped and official guidance used

- TanStack Intent: Router auth guards, data loading, typed search params, Start execution model, server routes, and Netlify deployment.
- Better Auth: use `drizzleAdapter` from `better-auth/adapters/drizzle`, the server `admin()` plugin for protected account administration, `disableSignUp: true`, and password changes that revoke other sessions.
- Aliyun: browser multipart upload must use short-lived STS credentials and bucket CORS; resumable upload checkpoints and exposed `ETag` are required for reliable direct upload.
- References: [Better Auth Drizzle adapter](https://www.better-auth.com/docs/adapters/drizzle), [Better Auth admin plugin](https://www.better-auth.com/docs/plugins/admin), [Better Auth options](https://www.better-auth.com/docs/reference/options), [Aliyun Browser.js multipart upload](https://help.aliyun.com/en/oss/developer-reference/multipart-upload-11), [Aliyun Browser.js installation and CORS](https://help.aliyun.com/en/oss/developer-reference/installation).

### Implementation clarifications that preserve approved behavior

1. The database keeps approved `applications`/`application_versions` table names; the public UI and API consistently say `programs`/`versions`.
2. Better Auth's admin plugin fields (`user.role`, `user.banned`, `user.banReason`, `user.banExpires`, and `session.impersonatedBy`) are technical auth fields, not product RBAC. `user.banned` is the only disabled-state enforcement owner. `admin_metadata` stores only `mustChangePassword`, `locale`, and `lastLoginAt`, avoiding a second disabled-state owner. Every account is created with role `admin`; no role-management UI or permission table exists.
3. A small `rate_limit_windows` table is added because Netlify function instances cannot provide a reliable process-local limiter. Better Auth owns login rate limits; Elysia uses the Neon-backed fixed-window limiter only for STS, administrator creation/reset, and profile password changes.
4. The authenticated shell and session guard are SSR-capable. Business page routes use `ssr: false` for phase one, so their Router loaders run in the browser and call the same-origin `/api/v1` through TanStack Query without duplicating cookie-forwarding adapters. API authorization remains server-side in Elysia.
5. Paginated list items include an opaque `etag` string so table-row mutations such as version activation can send `If-Match` without an extra detail request. Single-resource responses also emit the HTTP `ETag` header.
6. Upload idempotency uses the approved `path + sha256 + size` partial unique key and deterministic object key; no upload-session table or second upload state machine is introduced.

## BaselineUsageDraft

- Required baseline refs read: `AGENTS.md`, approved design spec, initial dual baseline, current scaffold files, UpdaterServer business sources, supplied screenshots, loaded Intent skills.
- Delivered context acknowledged: no Dashboard, dynamic persistent tabs, no Billing, no multi-tenancy, no client compatibility, redesigned errors/API, fresh Neon database, direct OSS upload.
- Baseline decisions carried forward: Elysia business ownership, Query cache ownership, Better Auth session ownership, server-only secrets, explicit migrations, multiple active versions, highest-active semantic latest, no automatic OSS deletion.
- Missing references: none blocking local implementation. Real cloud credentials are intentionally deferred to integration/Preview verification.
- Decision: proceed after the user selects an execution mode.

## Requirement Ready Check

- Goals and scope: approved in design sections 1–3.
- User/scenario coverage: login, program management, nested versions, upload, administrators, monitoring/audit, profile/account/system settings.
- Acceptance criteria: approved design section 17 plus the matrices below.
- Open blocker questions: none.
- Deferred external inputs: test/production Neon URL, Aliyun RAM role/bucket/CORS, Sentry project, and Netlify site credentials. Their absence does not block code, unit tests, contract tests, component tests, or local builds.
- Decision: ready for implementation planning and execution selection.

## Files and Canonical Owners

| Area | Canonical files/directories | Responsibility |
| --- | --- | --- |
| Runtime config | `src/server/env.server.ts`, `.env.example`, `src/env.d.ts` | Validate server/public environment boundaries without module-level secret reads |
| Database | `drizzle.config.ts`, `drizzle/`, `src/server/db/client.server.ts`, `src/server/db/schema/`, `src/server/db/repositories/` | Schema, migrations, SQL, transactions |
| Authentication | `src/server/auth/`, `src/lib/auth-client.ts`, `src/routes/api/auth/$.ts` | Better Auth config, session lookup, bootstrap, password/session operations |
| Business API | `src/server/api/`, `src/routes/api/v1/$.ts`, `src/routes/health.ts` | Elysia contracts, plugins, modules, transport, Problem Details |
| Shared wire types | `src/shared/api/` | Runtime-free DTO and query types safe for browser imports |
| App shell | `src/features/shell/`, `src/routes/_authenticated.tsx`, `src/routes/__root.tsx` | Responsive shell, toolbar, sidebar, persistent opened tabs |
| Remote data | `src/lib/api/`, per-feature `queries.ts` | Fetch/Problem parser, query keys/options, precise invalidation |
| Programs | `src/server/domain/programs.server.ts`, `src/server/api/modules/programs.ts`, `src/features/programs/`, `src/routes/_authenticated/programs.tsx` | Program vertical slice |
| Versions/uploads | `src/server/domain/versions.server.ts`, `src/server/integrations/oss/`, `src/features/versions/`, nested versions route | Semantic versions, relations, STS, hashing, multipart upload, table/form |
| Administrators/settings | `src/server/domain/administrators.server.ts`, `src/server/domain/settings.server.ts`, `src/features/administrators/`, `src/features/settings/` | Account façade, profile/account/system settings |
| Monitoring/audit | `src/server/domain/monitoring.server.ts`, `src/server/domain/audit.server.ts`, `src/features/monitoring/` | Health details, time series, audit filtering and display |
| Telemetry | `src/lib/sentry.client.ts`, `src/server/integrations/sentry/`, `vite.config.ts` | Browser/server capture, scrubbing, source maps |
| Tests | adjacent `*.test.ts(x)`, `src/test/`, `tests/e2e/` | Unit, contract, DB integration, component, E2E |

## Compatibility and Invariants

- `/api/auth/*` remains Better Auth; `/api/v1/*` is the only administration business API; `/health` is public liveness only.
- Every `/api/v1/*` route requires a valid, non-banned Better Auth session. `mustChangePassword` restricts the account to profile/password and sign-out operations until resolved.
- Start routes do not contain SQL, domain rules, or authorization decisions.
- API request/response JSON is camelCase; database columns are snake_case.
- IDs are UUIDs, timestamps are UTC `timestamptz`, and UI formatting defaults to `Asia/Shanghai`.
- Lists return `{ items, page, pageSize, total }`; page starts at 1; page size is one of 20, 50, 100.
- Mutations use `If-Match`; missing preconditions return 428 and stale writes return 409 `STALE_WRITE`.
- Soft deletion never triggers an OSS delete. Audit records are append-only and scrub secrets.
- No `tenantId`, organization, billing, subscription, invoice, updater-client manifest, download STS, or legacy compatibility path may appear.

## Change Necessity

| Proposed change | Why necessary | Smallest stable owner |
| --- | --- | --- |
| Start-to-Elysia catch-all | Required to run the requested Elysia API in the single Netlify site | One `src/routes/api/v1/$.ts` forwarding adapter |
| Better Auth admin plugin | Official server-side user creation, banning, password reset, and session revocation | `src/server/auth/auth.server.ts`; Elysia exposes the product façade |
| Kobalte-backed UI primitives | Accessible dialog/menu/tooltip behavior for the screenshot UI | Source-owned components under `src/components/ui/` |
| Neon-backed rate-limit windows | Serverless instances cannot share in-memory counters | One table and one API plugin/repository |
| Hash worker and multipart uploader | Large folder uploads must not buffer entire files or block the UI | Version feature worker/uploader modules |
| Native SVG chart | Demonstrates chart-ready data without adding a chart vendor | One monitoring component |

## Existence Check

- Proposed new surface: separate backend repository or deployment. Existing owner: TanStack Start Netlify server routes. Decision: reject; use the approved same-site adapter.
- Proposed new surface: new auth/account system. Existing owner: Better Auth plus admin plugin. Decision: reuse-existing.
- Proposed new surface: Elysia business API. Existing owner: scaffold has none; UpdaterServer is not a compatible owner. Creation proof: explicit user requirement and approved `/api/v1` boundary. Decision: add-with-proof.
- Proposed new surface: upload session state machine. Existing owner: deterministic key plus metadata unique index. Decision: reject.
- Proposed new surface: chart library. Existing owner: chart-ready query plus native SVG. Decision: reuse-existing.
- Proposed new surface: full i18n framework. Existing owner: two small typed catalogs and profile locale. Decision: reuse-existing local implementation.
- Proposed new surface: DB-backed rate limiter. Existing owner: Better Auth only covers auth routes and process memory is invalid across Netlify instances. Creation proof: approved rate-limited STS/admin/password endpoints. Decision: add-with-proof; expired windows are opportunistically deleted.
- Entropy/retirement impact: demo routes and demo owners are removed only after each requested TanStack integration has a real production proof.

## Architecture Integrity Lens

- Canonical owners are single and explicit: Router for URL/navigation, Query for remote state, Table for projection, Form for forms, Store for client UI state, Better Auth for sessions, Elysia for business contracts, Drizzle for SQL, OSS for binaries, Sentry for error telemetry.
- Dependency direction is `route/component -> feature query/form -> /api/v1 -> Elysia domain -> repository -> DB`; no reverse browser-to-server import is allowed.
- `*.server.ts` and server-only markers isolate secrets, DB clients, OSS permanent credentials, and Sentry server configuration.
- Elysia is constructed by a dependency-injected factory for contract tests; production singleton creation is separate from route definitions.
- Domain services own version comparison, last-admin protection, soft-delete cascades, file-set replacement, and audit intent. Repositories do not repeat those rules.
- The plan retires scaffold demos and does not add fallback APIs, duplicated caches, duplicated disabled state, or client compatibility branches.

## Complexity Budget

- Artifact class: source, test, decision/plan, and process artifacts.
- Target files/artifacts: new server modules, feature modules, adjacent tests, this plan, existing spec/context.
- Current pressure: low per source file but high project-wide fan-out; the approved design crosses auth, API, schema, upload, UI, monitoring, and deployment.
- Projected post-change pressure: at-risk if one Elysia app, domain service, table component, or test fixture becomes a generic owner.
- Budget result: within-budget only with the vertical slices below.
- Planned governance: route adapters under 120 lines, API module files under 250 lines, domain/repository/component owners under 400 lines where practical, maintained test files under 500 lines, shared fixtures split by domain, and no generic `utils.ts` growth for domain behavior.
- Pressure response: a touched file approaching 800 lines or receiving a second unrelated responsibility must be split before the batch can close.

## Plan Pressure Test

- Root/login outcome: `/` and successful login resolve to `/programs`; `/dashboard` does not exist.
- Navigation outcome: the toolbar is above the opened-tab bar, which is above the page title; `/programs` is pinned; version tabs retain their concrete program IDs; active close falls back left or to `/programs`.
- Auth outcome: no signup UI/API, all users are full admins, initial bootstrap is idempotent, temporary-password accounts must change password, banning revokes sessions, and the last active admin cannot be banned.
- Program outcome: case-sensitive partial uniqueness, URL-backed name filter/sort/page, soft delete of program and versions, no file/object deletion.
- Version outcome: canonical `major.minor.patch`, no leading zero/prerelease/build text, new number greater than current max, multiple active versions, numeric latest selection, transactional whole-file-set replacement including remove-only changes.
- Upload outcome: path traversal rejected, incremental SHA-256, bounded concurrency, progress/cancel/retry, STS least privilege, OSS direct body transfer, server HEAD/metadata verification, idempotent completion.
- Monitoring outcome: `/health` leaks no dependency details; authenticated status separates Neon/OSS checks; 7/30/90-day series remains chart-vendor-neutral; no Sentry Issue ingestion.
- Scope outcome: no Billing, tenant, legacy-client, data migration, download STS, or automatic OSS cleanup surface.

## Execution Readiness View

- High-risk seams: Better Auth schema/plugin integration, Netlify raw-request forwarding to Elysia, interactive Neon transactions, direct OSS multipart upload, stale-write handling, last-admin concurrency.
- Long-running seams: dependency installation, migrations against a disposable Neon branch, Playwright, production build, Netlify Preview smoke.
- Contract/schema seams: every API module, Better Auth schema, partial indexes, ETag/If-Match, audit redaction, upload metadata idempotency.
- Required review gates: foundation, auth/API core, programs, versions/uploads, administration/settings, monitoring/deployment, final retirement.
- Execution workspace precondition: because the repository has no commit, capture the approved scaffold/spec/plan as an initial baseline commit before creating the isolated implementation worktree.

## Contract Test Matrix

| Contract | Required proof |
| --- | --- |
| Authentication | Missing/expired session returns 401 on every `/api/v1` route; banned user returns 403; `mustChangePassword` can only access allowed profile/password paths |
| Problem Details | Every non-2xx body has `type`, `title`, `status`, `code`, `requestId`; validation adds `fieldErrors`; 500 output excludes stack, SQL, paths, cookies, tokens, and credentials |
| Pagination/search | Programs, versions, administrators, files, and audit return page-1 lists with clamped whitelist page sizes and whitelist sort fields |
| Concurrency | Detail/mutation responses emit ETag; mutation without `If-Match` is 428; stale token is 409 `STALE_WRITE`; success increments row version |
| Programs | Create/update uniqueness, name/description validation, soft-delete cascade, affected-version count, audit before/after |
| Versions | Canonical parse, numerical ordering, greater-than-max, uniqueness, multiple active, one numeric `isLatest`, activation isolation, whole-file-set replacement |
| Uploads | Path and hash validation, deterministic object keys, STS policy scope/TTL, HEAD mismatch conflict, duplicate completion returns same metadata IDs |
| Administrators | No public signup, create temporary-password admin, self-ban rejected, last-active-admin rejected under concurrency, ban/reset revoke sessions |
| Profile/settings | Locale/name update, current-password verification, other-session revocation, singleton settings validation and stale-write handling |
| Monitoring/audit | Public health is minimal; authenticated status separates checks; release series fills empty date buckets; filters are whitelisted; sensitive fields are redacted |
| Security controls | Same-origin mutation check, rate-limit 429 with retry metadata, request ID propagation, Sentry scrubber behavior |

## Schema / Migration Test Matrix

| Schema invariant | Required proof |
| --- | --- |
| Better Auth | `user`, `session`, `account`, `verification`, Better Auth's DB-backed rate-limit table, admin plugin fields, and `admin_metadata`; no organization/tenant/billing tables |
| Applications | Partial unique `name WHERE deleted_at IS NULL`; soft-deleted name can be reused; row version defaults to 1 |
| Versions | Partial unique program + numeric triplet; non-negative checks; active/latest ordering index; application FK is real and explicit |
| Files | Partial unique path + sha256 + size; lowercase 64-char hash validation in API; object key indexed; non-negative size |
| Version files | Composite primary key with exactly two real FKs; replacing with an empty set removes all relations |
| Audit | Append-only writes; UTC timestamp; JSON before/after; no update/delete domain API |
| System settings | Exactly one fixed singleton key; default locale/page size/name; row version concurrency |
| Rate limiting | Unique endpoint/subject/window key; atomic increment; expired rows can be deleted without affecting active windows |

## Implementation Batches

### Batch 0: Capture the approved baseline and create the execution worktree

**Files:** current repository tree; no source edits.

1. Re-run the scaffold baseline: `pnpm intent:list`, `pnpm check`, `pnpm typecheck`, `pnpm test`, and `pnpm build`.
2. Inspect `git diff --check`, stage the approved scaffold/spec/plan, and create `chore: capture updater admin scaffold baseline`.
3. Create branch/worktree `codex/updater-admin-implementation` from that commit and perform all later edits there.
4. Verify `git status --short --branch` is clean in the implementation worktree and the design/plan paths resolve.

**Gate:** baseline commands pass and an isolated clean worktree exists. If a command regresses before source edits, stop and repair only the scaffold baseline.

### Batch 1: Install runtime dependencies and establish deterministic test/tooling commands

**Files:** `package.json`, `pnpm-lock.yaml`, `vitest.config.ts`, `vitest.db.config.ts`, `playwright.config.ts`, `src/test/setup.ts`, `src/env.d.ts`, `.gitignore`.

1. Add runtime packages: `@alicloud/credentials`, `@alicloud/openapi-client`, `@alicloud/sts20150401`, `@alicloud/tea-util`, `@kobalte/core`, `@sentry/node`, `ali-oss`, `hash-wasm`, `lucide-solid`, and `ws`.
2. Add development packages: `@better-auth/cli`, `@playwright/test`, `@sentry/vite-plugin`, `@types/node`, `@types/ws`, `dotenv`, and `tsx`.
3. Add an explicit top-level `intent.skills` allowlist for `@tanstack/cli`, `@tanstack/devtools-vite`, `@tanstack/router-plugin`, `@tanstack/solid-router`, `@tanstack/solid-start`, `@tanstack/devtools-event-client`, `@tanstack/router-core`, `@tanstack/virtual-file-routes`, `@tanstack/start-client-core`, and `@tanstack/start-server-core`; rerun `pnpm intent:list` and require the missing-allowlist notice to disappear.
4. Replace the permissive test script with deterministic commands: `test="vitest run"`, `test:watch="vitest"`, `test:db="vitest run --config vitest.db.config.ts"`, `test:e2e="playwright test"`, `db:generate="drizzle-kit generate"`, `db:migrate="drizzle-kit migrate"`, `db:check="drizzle-kit check"`, and `bootstrap:admin="tsx scripts/bootstrap-admin.ts"`.
5. Configure the normal Vitest project for `jsdom`, Solid transform, setup cleanup, and exclusion of `*.db.test.ts`; configure `vitest.db.config.ts` for serial Node-environment execution of only `*.db.test.ts`. Configure Playwright with Chromium, desktop/mobile projects, trace-on-first-retry, and `pnpm dev` webServer.
6. Add `src/test/setup.ts` and one real configuration smoke test so `--passWithNoTests` can be removed immediately.

**Verify:** `pnpm install`, `pnpm check`, `pnpm typecheck`, `pnpm test`, `pnpm exec playwright install --dry-run`, `pnpm build`.

**Commit:** `chore: establish updater admin tooling and test harness`.

### Batch 2: Define validated environment access, Drizzle schema, and initial migration

**Files:** `drizzle.config.ts`, `drizzle/` generated artifacts, `src/server/env.server.ts`, `src/server/db/client.server.ts`, `src/server/db/schema/auth.ts`, `src/server/db/schema/business.ts`, `src/server/db/schema/security.ts`, `src/server/db/schema/index.ts`, `src/server/db/schema/schema.test.ts`, `.env.example`.

1. Implement per-call environment parsing with named errors and no module-level secret reads. Only `VITE_SENTRY_DSN` is browser-readable.
2. Configure the Neon serverless `Pool` and `drizzle-orm/neon-serverless` in a server-only lazy singleton suitable for interactive transactions; set bounded pool limits and Node WebSocket support.
3. Generate the Better Auth schema with the CLI as comparison input, then commit an explicit schema matching email/password, database-backed Better Auth rate limits, admin plugin fields, and `admin_metadata(mustChangePassword, locale, lastLoginAt)`.
4. Add `applications`, `application_versions`, `file_metadata`, `version_files`, `audit_events`, `system_settings`, and `rate_limit_windows` with the approved checks, partial indexes, real FKs, UTC timestamps, and row versions.
5. Generate and inspect the initial Drizzle migration; ensure there are no tenant, organization, billing, subscription, invoice, role-management, OpenIddict, or legacy-data tables.
6. Add schema tests that inspect table/index metadata, plus disposable-database tests for partial uniqueness, checks, singleton settings, and remove-all `version_files` behavior.

**Verify:** `pnpm db:generate`, `pnpm db:check`, `pnpm test -- src/server/db/schema/schema.test.ts`; with `TEST_DATABASE_URL` set to a disposable Neon branch, run `pnpm test:db`; then `pnpm check`, `pnpm typecheck`, `pnpm build`.

**Commit:** `feat: add updater admin database schema`.

### Batch 3: Wire Better Auth, bootstrap, and server-side session helpers

**Files:** `src/server/auth/auth.server.ts`, `src/server/auth/session.server.ts`, `src/server/auth/bootstrap.server.ts`, `src/server/auth/auth.test.ts`, `scripts/bootstrap-admin.ts`, `src/lib/auth-client.ts`, `src/lib/session-query.ts`, `src/routes/api/auth/$.ts`, `.env.example`.

1. Move the scaffold auth configuration into `auth.server.ts`; connect `drizzleAdapter(db, { provider: "pg", schema })`; configure email/password, `disableSignUp: true`, trusted origins, cookie security, Better Auth rate limits with database storage, and `admin({ defaultRole: "admin", adminRoles: ["admin"] })`.
2. Keep the Start auth route as a raw Better Auth handler and remove all auth-demo coupling.
3. Implement `getSession(headers)` and a Start server function used only for Router/session UX. Join `admin_metadata` so the session view includes `mustChangePassword` and locale; Elysia independently validates the same session plus metadata on every business request.
4. Implement an idempotent bootstrap that refuses missing/weak values, creates exactly one initial admin through the Better Auth server API, writes metadata, and exits successfully when that email already exists.
5. Configure creation/reset helpers so temporary-password users have `mustChangePassword=true`; update `lastLoginAt` from the successful session-creation hook.
6. Test disabled signup, metadata-enriched session lookup, last-login hook, bootstrap idempotency, admin-only role defaults, and secret-free error output.

**Verify:** `pnpm test -- src/server/auth/auth.test.ts`, `pnpm check`, `pnpm typecheck`, `pnpm build`; with a disposable DB, run `pnpm bootstrap:admin` twice and prove only one user exists.

**Commit:** `feat: connect better auth to neon`.

### Batch 4: Build the Elysia API foundation, transport adapter, and security plugins

**Files:** `src/shared/api/common.ts`, `src/shared/api/profile.ts`, `src/server/security/redact.ts`, `src/server/security/redact.test.ts`, `src/server/db/repositories/audit.server.ts`, `src/server/db/repositories/rate-limit.server.ts`, `src/server/api/problem.ts`, `src/server/api/schemas/common.ts`, `src/server/api/context.server.ts`, `src/server/api/plugins/request-id.ts`, `src/server/api/plugins/session.server.ts`, `src/server/api/plugins/origin.server.ts`, `src/server/api/plugins/rate-limit.server.ts`, `src/server/api/plugins/audit.server.ts`, `src/server/api/modules/profile.ts`, `src/server/api/app.server.ts`, `src/server/api/app.test.ts`, `src/routes/api/v1/$.ts`, `src/routes/health.ts`.

1. Define browser-safe `Page<T>`, `ApiProblem`, `FieldError`, `EntityResult<T>`, locale, sort, and ETag types under `src/shared/api/`; keep Elysia runtime schemas canonical and prove response/type alignment in contract tests. Format row versions as opaque weak ETags.
2. Implement a single Problem Details mapper for validation, auth, not-found, conflict, precondition, rate-limit, and internal errors. Production 500 responses expose only request ID and stable code.
3. Implement the shared recursive redactor before any audited write route exists. Implement append-only audit writes and atomic rate-window increments as focused repositories.
4. Construct Elysia from injected dependencies. Add request ID propagation, same-origin mutation enforcement, session/banned/must-change checks, rate limiting, audit context, and centralized error mapping.
5. Implement `GET /health` outside authenticated `/api/v1`; return only `{ status: "ok" }`.
6. Add the minimum profile contract needed to complete authentication: `GET /api/v1/profile` and `POST /api/v1/profile/change-password`. Change password through Better Auth using the current session, clear `mustChangePassword`, revoke every old session, and return a reauthentication requirement; the browser then signs in with the new password to establish a fresh session.
7. Implement the Start splat route as method-for-method raw `Request` forwarding to Elysia. Do not parse JSON, query the DB, or make authorization decisions in the Start route.
8. Add contract tests using `app.handle(new Request("http://localhost/api/v1/programs", requestInit))` for raw body/query/headers, 401/403/422/428/429/500 Problem Details, request IDs, origin checks, forced-password route restrictions, session rotation, redaction, and `/health` secrecy.

**Verify:** `pnpm test -- src/server/api/app.test.ts`, `pnpm check`, `pnpm typecheck`, start the app and curl `/health` plus an unauthenticated `/api/v1` path, then `pnpm build`.

**Commit:** `feat: add elysia api foundation`.

### Batch 5: Replace the demo shell with auth flow, localization, responsive navigation, and real opened tabs

**Files:** `src/router.tsx`, `src/routes/__root.tsx`, `src/routes/index.tsx`, `src/routes/login.tsx`, `src/routes/_authenticated.tsx`, `src/features/auth/login-form.tsx`, `src/features/auth/change-password-form.tsx`, `src/features/shell/app-shell.tsx`, `src/features/shell/sidebar.tsx`, `src/features/shell/topbar.tsx`, `src/features/shell/tabs.tsx`, `src/features/shell/ui-store.ts`, `src/features/shell/ui-store.test.ts`, `src/lib/i18n/catalogs.ts`, `src/lib/i18n/i18n.tsx`, `src/components/ui/button.tsx`, `src/components/ui/input.tsx`, `src/components/ui/textarea.tsx`, `src/components/ui/field.tsx`, `src/components/ui/dialog.tsx`, `src/components/ui/dropdown-menu.tsx`, `src/components/ui/tooltip.tsx`, `src/components/ui/switch.tsx`, `src/components/ui/table-shell.tsx`, `src/components/ui/pagination.tsx`, `src/components/ui/toast.tsx`, `src/styles.css`.

1. Type Router context with QueryClient and session query options. Keep `defaultPreloadStaleTime: 0`.
2. Implement `/` redirect, public `/login`, and a pathless `_authenticated` guard. Validate `returnTo` against registered internal protected paths to prevent open redirects; redirect `mustChangePassword` sessions to the change-password view.
3. Build the approved shell: 232/64px sidebar, 56px top toolbar, opened-tab bar directly below it, then page title/content. Under 1024px use an accessible drawer.
4. Implement the TanStack Store owner with pinned `/programs`, `openOrActivateTab`, `closeTab`, left-neighbor fallback, version-tab keys containing program ID, sessionStorage hydration, sidebar state, and locale fallback.
5. Complete the forced-password form against the Batch 4 profile endpoint. On success, sign in again through Better Auth with the new password so the revoked session is replaced before navigating to `/programs`.
6. Add typed zh-CN/en catalogs, default zh-CN, profile-locale handoff, language menu, localized API-code mapping, date/number formatting, and `lang` updates.
7. Add Kobalte-backed shadcn-style button/input/dialog/dropdown/tooltip/switch/table-shell/pagination primitives with focus rings, reduced motion, names, and responsive behavior.
8. Test real opened-page retention across programs, administrators, monitoring, and two distinct version pages; inactive/active close behavior; reload hydration; invalid `returnTo`; forced password/session replacement; keyboard navigation; no Dashboard route.

**Verify:** targeted component/store tests, `pnpm check`, `pnpm typecheck`, `pnpm test`, `pnpm build`, then Playwright navigation through at least four pages proving tabs persist.

**Commit:** `feat: add authenticated admin shell and persistent tabs`.

### Batch 6: Implement the program vertical slice end to end

**Files:** `src/shared/api/programs.ts`, `src/server/db/repositories/programs.server.ts`, `src/server/domain/programs.server.ts`, `src/server/domain/programs.test.ts`, `src/server/api/modules/programs.ts`, `src/server/api/modules/programs.test.ts`, `src/lib/api/client.ts`, `src/lib/api/query-keys.ts`, `src/features/programs/api.ts`, `src/features/programs/queries.ts`, `src/features/programs/program-table.tsx`, `src/features/programs/program-form.tsx`, `src/features/programs/program-dialogs.tsx`, `src/features/programs/programs-page.tsx`, `src/features/programs/programs-page.test.tsx`, `src/routes/_authenticated/programs.tsx`.

1. Add the typed fetch client that parses ETag and Problem Details, throws `ApiProblemError`, includes credentials, and never imports server runtime code.
2. Implement program repository queries with whitelist name filter, created-time sort, page sizes, detail lock/read, partial uniqueness, row-version update, and transactional soft-delete cascade.
3. Implement domain validation, conflict mapping, ETag creation, audit before/after, and affected-version count. Preserve file metadata and OSS objects on delete.
4. Mount GET/POST/detail/PATCH/DELETE schemas and handlers in Elysia with exact list and concurrency contracts.
5. Implement typed Router search (`name`, `page`, `pageSize`, `sort`, dialog IDs), loaders that only call `queryClient.ensureQueryData`, TanStack Table server state, TanStack Form create/edit dialogs, copy-ID feedback, confirmation text, and screenshot-style numbered pagination.
6. Test URL round-trip, page reset on filter, sort whitelist, empty state, field/server errors, stale-write recovery, soft-delete confirmation, query invalidation, and table accessibility.

**Verify:** program domain/API/component tests; disposable-DB uniqueness/concurrency tests; Playwright create/filter/edit/delete flow; `pnpm check`, `pnpm typecheck`, `pnpm test`, `pnpm build`.

**Commit:** `feat: implement program management`.

### Batch 7: Implement semantic-version and file-relation backend rules

**Files:** `src/shared/api/versions.ts`, `src/shared/api/files.ts`, `src/server/db/repositories/versions.server.ts`, `src/server/db/repositories/files.server.ts`, `src/server/domain/version-number.ts`, `src/server/domain/version-number.test.ts`, `src/server/domain/versions.server.ts`, `src/server/domain/versions.test.ts`, `src/server/api/modules/versions.ts`, `src/server/api/modules/files.ts`, `src/server/api/modules/versions.test.ts`, `src/server/api/modules/files.test.ts`.

1. Parse only canonical numeric `major.minor.patch`; return normalized text plus integer triplet; reject signs, whitespace, leading zeros, prerelease, build metadata, overflow, and extra/missing segments.
2. Lock the parent application row in create/change-number transactions, read the current maximum numeric triplet, and enforce strict greater-than plus the partial unique index.
3. Implement version list/detail/create/update/delete/activation/nested files plus the approved paginated `GET /api/v1/files` and `GET /api/v1/files/{fileId}` metadata endpoints. Multiple active rows remain untouched; after each list/mutation mark exactly the numerically highest active row `isLatest`.
4. Replace version file relations transactionally only when `fileIds` is present. An empty array removes all relations; omitted `fileIds` preserves them. Audit full before/after ID sets so the UpdaterServer remove-only defect cannot recur.
5. Soft delete versions without deleting file metadata or objects; require ETag/If-Match for update/delete/activation.
6. Test parser boundaries, `1.10.0 > 1.9.99`, concurrent max creation, multiple active/latest, activation isolation, remove-only replacement, omitted replacement, stale writes, and soft deletion.

**Verify:** version unit/contract tests, disposable-DB transaction tests, `pnpm check`, `pnpm typecheck`, `pnpm test`, `pnpm build`.

**Commit:** `feat: add version management domain and api`.

### Batch 8: Implement short-lived STS, incremental hashing, and direct multipart upload

**Files:** `src/shared/api/uploads.ts`, `src/server/integrations/oss/object-key.ts`, `src/server/integrations/oss/path.ts`, `src/server/integrations/oss/sts.server.ts`, `src/server/integrations/oss/client.server.ts`, `src/server/integrations/oss/oss.test.ts`, `src/server/domain/uploads.server.ts`, `src/server/api/modules/uploads.ts`, `src/server/api/modules/uploads.test.ts`, `src/features/versions/hash-worker.ts`, `src/features/versions/oss-uploader.client.ts`, `src/features/versions/upload-store.ts`, `src/features/versions/upload-store.test.ts`, `src/features/versions/folder-picker.tsx`, `src/features/versions/upload-queue.tsx`, `.env.example`, `README.md`.

1. Validate relative POSIX paths, size/count limits, lowercase SHA-256, MIME, and duplicate paths. Reject absolute paths, `..`, backslashes, control characters, empty segments, and normalized collisions.
2. Generate deterministic object keys from configured prefix, SHA-256, and safely encoded normalized path. Sign a short-TTL AssumeRole policy limited to the configured bucket/prefix; never return permanent keys.
3. Before metadata registration, recompute/compare object key and HEAD the OSS object to verify existence, byte size, and ETag. Atomically upsert by the partial unique tuple; matching replay returns the original IDs, conflicting object data returns `UPLOAD_METADATA_CONFLICT`.
4. Hash files incrementally in a worker with bounded chunks. Do not call `file.arrayBuffer()` for the entire release file.
5. Upload directly with `ali-oss` multipart upload, concurrency 4, progress, checkpoint, cancel, and per-file retry. Keep `File` objects/checkpoints only in the in-memory TanStack Store; sessionStorage persists non-File UI state only.
6. Document required OSS CORS origins/methods/headers and exposed `ETag`, RAM trust/policy, prefix, TTL, and why no file body traverses Netlify.
7. Test path/object-key vectors, policy scope without secrets, idempotent races, HEAD mismatch, queue transitions, aggregate progress, retry/cancel, and mocked multipart callbacks.

**Verify:** upload unit/contract/component tests; optional authorized OSS sandbox smoke for STS + small multipart object without deletion; `pnpm check`, `pnpm typecheck`, `pnpm test`, `pnpm build`.

**Commit:** `feat: add direct oss release uploads`.

### Batch 9: Build the nested version-management page and optimistic activation UI

**Files:** `src/features/versions/api.ts`, `src/features/versions/queries.ts`, `src/features/versions/version-table.tsx`, `src/features/versions/version-form.tsx`, `src/features/versions/version-dialogs.tsx`, `src/features/versions/versions-page.tsx`, `src/features/versions/versions-page.test.tsx`, `src/routes/_authenticated/programs.$programId.versions.tsx`.

1. Validate route params and typed search for page/pageSize/sort/dialog state; fetch the program name plus version page through Query-backed Router loaders.
2. Render the screenshot-aligned table: sequence, copyable ID, semantic version, description, enabled switch, latest badge, created time, actions, refresh, and numbered pagination.
3. Connect create to folder picker -> hash -> STS -> multipart -> complete -> version-create. Disable submit until all required uploads are complete; preserve successful metadata IDs when retrying a failed final create.
4. Implement edit description/optional greater version/explicit folder replacement; omitted folder preserves relations and an explicit empty folder replaces with none only after confirmation.
5. Implement optimistic activation with per-row mutation serialization, cached ETag, rollback on Problem Details, precise list/detail invalidation, and latest-badge recomputation from the server response.
6. Open the tab key `versions:{programId}` with title `版本 · {programName}` and retain its concrete href across navigation/reload.
7. Test upload/form state, optimistic success/rollback/stale-write flow, numeric latest display, pagination, two distinct program tabs, and delete without OSS side effects.

**Verify:** version component tests; Playwright program -> versions -> upload-stub/create -> activate/edit/delete flow; full static/test/build gate.

**Commit:** `feat: add nested version management ui`.

### Batch 10: Implement administrator, profile, and account management

**Files:** `src/shared/api/administrators.ts`, `src/shared/api/profile.ts`, `src/server/db/repositories/administrators.server.ts`, `src/server/domain/administrators.server.ts`, `src/server/domain/administrators.test.ts`, `src/server/api/modules/administrators.ts`, `src/server/api/modules/profile.ts`, `src/server/api/modules/administrators.test.ts`, `src/features/administrators/api.ts`, `src/features/administrators/queries.ts`, `src/features/administrators/administrator-table.tsx`, `src/features/administrators/administrator-form.tsx`, `src/features/administrators/administrator-dialogs.tsx`, `src/features/administrators/administrators-page.tsx`, `src/features/administrators/administrators-page.test.tsx`, `src/features/settings/profile-form.tsx`, `src/features/settings/account-page.tsx`, `src/routes/_authenticated/administrators.tsx`, `src/routes/_authenticated/settings.profile.tsx`, `src/routes/_authenticated/settings.account.tsx`.

1. Expose paginated administrators through Elysia while delegating password hashes, bans, and session lifecycle to Better Auth. Never expose hashes, tokens, or session cookies.
2. Serialize ban/enable operations with a DB advisory transaction lock; reject self-ban and a transition that would leave zero active admins; revoke the target's sessions on ban.
3. Create administrators with name/email/temporary password, role fixed to `admin`, and `mustChangePassword=true`; reset password similarly and revoke sessions.
4. Extend the existing profile module with name/locale and current/other session summaries. Reuse the Batch 4 password-rotation contract; use Better Auth's session API directly from the account UI for revoke-other-sessions rather than adding a second Elysia session owner.
5. Build TanStack Table/Form UI and the screenshot account menu. Do not add role selectors, invitations, tenant controls, or public signup.
6. Test concurrent last-admin attempts, self-ban, duplicate email, temporary-password gate, reset/session revocation, profile locale persistence, account-menu sign-out, and secret redaction.

**Verify:** auth/admin domain/contract/component tests; disposable-DB concurrency tests; Playwright bootstrap-login -> create admin -> forced change -> revoke/ban flow; full static/test/build gate.

**Commit:** `feat: add administrator and account management`.

### Batch 11: Implement system settings with optimistic concurrency

**Files:** `src/shared/api/settings.ts`, `src/server/db/repositories/settings.server.ts`, `src/server/domain/settings.server.ts`, `src/server/domain/settings.test.ts`, `src/server/api/modules/settings.ts`, `src/server/api/modules/settings.test.ts`, `src/features/settings/system-form.tsx`, `src/routes/_authenticated/settings.system.tsx`.

1. Read/create the fixed singleton and expose system name, default locale, page size, and optional HTTPS repository URL only.
2. Validate locale and page-size enums, normalize empty repository URL to null, require ETag, increment row version, and audit changes.
3. Build TanStack Form UI and update shell title/defaults after success without copying settings into a second persistent client store.
4. Test singleton races, invalid URL/page size, stale write, locale fallback, repository-icon conditional visibility, and exact query invalidation.

**Verify:** settings unit/contract/component tests and full static/test/build gate.

**Commit:** `feat: add system settings`.

### Batch 12: Implement monitoring, release time series, audit table, and native SVG chart

**Files:** `src/shared/api/monitoring.ts`, `src/shared/api/audit.ts`, `src/server/db/repositories/audit.server.ts`, `src/server/db/repositories/monitoring.server.ts`, `src/server/domain/audit.server.ts`, `src/server/domain/monitoring.server.ts`, `src/server/api/modules/monitoring.ts`, `src/server/api/modules/audit.ts`, `src/server/api/modules/monitoring.test.ts`, `src/features/monitoring/status-cards.tsx`, `src/features/monitoring/release-series-chart.tsx`, `src/features/monitoring/audit-table.tsx`, `src/features/monitoring/audit-detail.tsx`, `src/routes/_authenticated/monitoring.overview.tsx`, `src/routes/_authenticated/monitoring.audit.tsx`.

1. Implement authenticated status with independently timed/cached Neon `SELECT 1`, OSS STS readiness, application/build metadata, active-version count, storage totals, and recent operations. A failed dependency returns a degraded section, not an unhandled 500.
2. Query 7/30/90-day release counts in UTC day buckets, fill missing days with zero, and return the approved renderer-neutral `TimeSeries` DTO.
3. Extend the Batch 4 append-only audit repository with pagination/filtering by actor/action/resource/result/date and details with before/after JSON. Reuse the central redactor for password, authorization, cookie, session, STS, permanent keys, signed URLs, and nested variants before persistence.
4. Build status cards, an accessible native SVG line/bar chart with text summary, recent operations, and TanStack Table audit UI with URL-backed filters.
5. Test bucket boundaries/zero fill, degraded readiness, status secrecy, redaction fixtures, filter whitelists, JSON diff rendering, 7/30/90 switching, and no Sentry Issue requests.

**Verify:** monitoring/audit unit/contract/component tests; Playwright overview/audit filtering; full static/test/build gate.

**Commit:** `feat: add monitoring and audit views`.

### Batch 13: Finish Sentry, Netlify, source maps, and cross-cutting security verification

**Files:** `src/lib/sentry.client.ts`, `src/server/integrations/sentry/sentry.server.ts`, `src/server/security/redact.ts`, `src/server/security/redact.test.ts`, `src/router.tsx`, `src/server/api/app.server.ts`, `vite.config.ts`, `netlify.toml`, `.env.example`, `README.md`.

1. Initialize `@sentry/solid` only when `VITE_SENTRY_DSN` exists; initialize `@sentry/node` lazily per server runtime; tag request ID, environment, release, route, and actor ID without PII payloads.
2. Apply the same recursive scrubber to audit and Sentry `beforeSend`; drop headers/query/body fields that can contain secrets or signed URLs.
3. Add conditional `@sentry/vite-plugin` source-map upload only when build credentials are present. A local build without Sentry credentials must still succeed.
4. Verify Netlify plugin order, publish directory, function routing, Node runtime, canonical Better Auth URL, same-origin cookie behavior, and explicit pre-deploy `pnpm db:migrate`. Do not run migrations during request startup.
5. Document all environment variables and follow-up cloud setup: Neon migration, one-time bootstrap removal, OSS RAM/CORS, Sentry project, Netlify canonical URL/secrets.
6. Add cross-cutting tests for CSRF/origin, rate limits, request ID propagation, secure-cookie production config, scrubber coverage, and server-only import boundaries.

**Verify:** `pnpm check`, `pnpm typecheck`, `pnpm test`, `pnpm build`; local `netlify dev` smoke when CLI/auth are available; authorized Preview checks for `/login`, `/health`, protected redirect, `/api/v1` 401, session cookie, DB readiness, STS readiness, and Sentry test event.

**Commit:** `feat: finalize sentry and netlify integration`.

### Batch 14: Retire scaffold demos and run release-level verification

**Delete:** `src/components/Header.tsx`, `src/integrations/better-auth/header-user.tsx`, `src/integrations/tanstack-query/header-user.tsx`, `src/lib/auth.ts`, `src/lib/demo-store.ts`, `src/routes/about.tsx`, `src/routes/demo.better-auth.tsx`, `src/routes/demo.form.tsx`, `src/routes/demo.sentry.bad-event-handler.tsx`, `src/routes/demo.store.tsx`, `src/routes/demo.tanstack-query.tsx`.

**Update:** `README.md`, `AGENTS.md`, `docs/aegis/baseline/2026-07-14-initial-baseline.md`, `src/routeTree.gen.ts` through route generation, `tests/e2e/auth.spec.ts`, `tests/e2e/tabs.spec.ts`, `tests/e2e/programs.spec.ts`, `tests/e2e/versions.spec.ts`, `tests/e2e/administrators.spec.ts`, `tests/e2e/settings.spec.ts`, `tests/e2e/monitoring.spec.ts`, `tests/e2e/responsive-accessibility.spec.ts`.

1. Prove every requested TanStack library has a real production owner before deleting its demo: Start/Router shell and routes, Query remote cache, Table lists, Form forms, Store tabs/upload queue, CLI scripts/metadata, Intent context/guidance.
2. Delete demo routes/components and stale imports; regenerate the route tree; assert no `/demo/*`, `/about`, `/dashboard`, `/billing`, tenant, or legacy `/api/app/*` route remains.
3. Add E2E suites for auth/returnTo/forced password, persistent tabs, programs, versions/upload stub, administrators, settings, monitoring/audit, locale, mobile drawer, keyboard-only flow, and stale-write recovery.
4. Compare desktop program/version pages and dialogs against the eight reference screenshots; capture 1920px desktop and 390px mobile evidence. Verify high-fidelity green spacing, toolbar-tab-title order, pagination, modals, language menu, and account menu without copying screenshot defects.
5. Run an accessibility pass: landmarks, headings, labels, table captions, icon names/tooltips, focus trap/return, color contrast, reduced motion, horizontal table scroll, chart text alternative.
6. Run the full command matrix. Scan production routes with `rg -n '/dashboard|/billing|/api/app/' src/routeTree.gen.ts src/routes --glob '!**/*.test.*'`; it must return no matches. Scan client output with `rg -n 'DATABASE_URL|OSS_ACCESS_KEY_SECRET|BETTER_AUTH_SECRET|SENTRY_AUTH_TOKEN|BOOTSTRAP_ADMIN_PASSWORD' dist/client`; it must return no matches.
7. Update durable context with final env/setup/deployment steps, known gotchas, verified commands, and remaining external actions. Preserve one ADR signal for the proven same-origin Start/Elysia boundary; create an ADR only if the implementation evidence still shows the decision is durable and non-obvious.

**Verify:** `pnpm intent:list`, `pnpm check`, `pnpm typecheck`, `pnpm test`; with `TEST_DATABASE_URL` set to a disposable Neon branch, run `pnpm test:db`; then run `pnpm test:e2e`, `pnpm build`, `git diff --check`, route/secret scans, and authorized Netlify Preview smoke.

**Commit:** `chore: complete updater admin verification and retire demos`.

## Final Acceptance Checklist

- Login and `/` enter `/programs`; no Dashboard route or nav item exists.
- Dynamic tabs persist real opened-page history and appear between toolbar and title.
- Programs and versions match the supplied desktop visual direction and remain usable on mobile/keyboard.
- Better Auth signup is disabled; new admins use temporary passwords; all accounts have identical full access; last-admin and session-revocation rules hold.
- Elysia owns every approved `/api/v1` route and rejects unauthenticated/stale/invalid requests with compact Problem Details.
- Drizzle migrations create only approved auth/business/security tables in a fresh Neon database.
- Multiple versions can be active and exactly the numerically highest active version is latest.
- Folder upload hashes incrementally and sends file bodies browser-to-OSS with progress/retry/cancel; Netlify receives metadata only.
- Monitoring exposes minimal public liveness plus authenticated readiness, audit, and renderer-neutral release series; Sentry receives scrubbed browser/server errors only.
- No Billing, tenant, legacy client API, legacy data import, Sentry Issue ingestion, download STS, or automatic OSS deletion exists.
- Biome, TypeScript, unit/contract/component/DB/E2E tests, production build, secret scan, and authorized Preview smoke all pass.

## Risks and Stop Conditions

- Stop if Better Auth generated schema and committed schema disagree on required plugin fields; reconcile before migration.
- Stop if Neon's selected driver cannot prove interactive transaction/lock behavior in a disposable branch; do not emulate correctness with process locks.
- Stop if Start-to-Elysia forwarding changes request body, cookies, status, or headers; repair the single adapter before adding modules.
- Stop if an OSS test would require production credentials, object deletion, or a broader RAM policy; use mocks/sandbox and request separate authority.
- Stop if a proposed convenience adds tenant/Billing/client-compatibility/data-migration state or duplicates a canonical owner.
- Stop completion if any high-risk contract lacks automated evidence, if source/test complexity is exceeded and unresolved, or if real Preview behavior contradicts local verification.

## Retirement and Documentation

- Retire scaffold demos only in Batch 14 after real library demonstrations exist.
- Retain `.cta.json`, `ui.config.json`, TanStack Intent instructions, Netlify adapter, and generated route structure.
- Remove `OSS_DOWNLOAD_RAM_ROLE_ARN` permanently; download STS is out of scope.
- Never add cleanup code that deletes legacy or new OSS objects. Future orphan governance is a separately authorized feature.
- At completion, change the initial baseline status to implemented/verified with evidence rather than rewriting historical facts.

## Execution Handoff

After plan review, choose one:

1. **Subagent-Driven (recommended for this long plan):** execute independent bounded batches with `aegis:subagent-driven-development`, one review gate per batch. This option requires an explicit user request before any subagent is spawned.
2. **Inline Execution:** execute sequentially in this task with `aegis:executing-plans`, using the same worktree, batch gates, and stop conditions.
