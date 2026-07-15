# Updater Admin Implementation - Checkpoint

- Task ID: 2026-07-14-updater-admin-implementation
- Current todo: Batch 0 baseline commit and isolated worktree
- Active slice: Foundation preflight
- Blocked on: none
- Next step: Run Intent and scaffold verification, commit baseline, create .worktrees/codex-updater-admin-implementation

## DriftCheckDraft

- Scope status: Batch 0 only; no business code
- Compatibility status: New /api/v1 boundary unchanged; no legacy compatibility
- Retirement status: Demo routes retained until Batch 14
- New risk signals:
- Repository has no initial commit; baseline commit is required before worktree creation
- Advisory decision: continue

## Checkpoint Update

- Current todo: Batch 1: establish tooling, dependencies, Intent allowlist, and deterministic test harness
- Active slice: Batch 1 tooling and test harness
- Completed todos:
- Batch 0: isolated worktree created; pnpm install --frozen-lockfile, check, typecheck, baseline test, and Netlify build passed
- Evidence refs:
- baseline commit c300d38
- fresh worktree check/typecheck/test/build pass on 2026-07-14
- Blocked on: none
- Next step: Load current TanStack Intent CLI guidance and dispatch Batch 1 implementer

## DriftCheckDraft

- Scope status: Batch 0 only established isolated execution and verification; no business scope changes.
- Compatibility status: No legacy compatibility paths added.
- Retirement status: Generated demos remain temporarily and are scheduled for removal in Batch 14.
- New risk signals:
- none
- Advisory decision: continue

## Checkpoint Update

- Current todo: Batch 2: validated environment access, Drizzle schema, and initial migration
- Active slice: Batch 2 database foundation
- Completed todos:
- Batch 0: isolated worktree and fresh baseline verification
- Batch 1: dependencies, Intent allowlist, deterministic Vitest/DB/Playwright harness; spec and quality reviews passed
- Evidence refs:
- Batch 1: offline frozen install, intent:list, check, typecheck, 2 Vitest tests, Playwright dry-run, build, diff-check all exit 0
- Batch 1 spec review PASS; quality review PASS after test-discovery and hardening fixes
- Blocked on: none
- Next step: Implement the approved schema/environment slice from current local Drizzle, Neon, and Better Auth APIs

## DriftCheckDraft

- Scope status: Batch 1 stayed within tooling, dependency, environment typing, and test-harness scope.
- Compatibility status: No Billing, tenancy, legacy-client compatibility, or business API surface added.
- Retirement status: Scaffold demos intentionally remain until real TanStack owners exist and Batch 14 retires them.
- New risk signals:
- none
- Advisory decision: continue

## DriftCheckDraft

- Scope status: Batch 2 stayed within environment validation, Drizzle/Neon database foundation, schema, migration, and destructive-test safety.
- Compatibility status: No Billing, tenancy, legacy-client compatibility, Dashboard, or business API surface added.
- Retirement status: Generated demos remain intentionally deferred until canonical application owners exist and Batch 14 removes them.
- New risk signals:
- Disposable DB integration remains unexecuted because TEST_DATABASE_URL is absent; the guard and explicit skip behavior are verified.
- Advisory decision: continue

## Checkpoint Update

- Current todo: Batch 3: Better Auth runtime, bootstrap, and safe session boundary
- Active slice: Batch 3 authentication foundation
- Completed todos:
- Batch 0: isolated worktree and fresh baseline verification
- Batch 1: tooling, dependencies, Intent allowlist, and deterministic test harness
- Batch 2: validated environment access, 13-table Drizzle schema, guarded destructive DB tests, and sole initial migration; spec and quality reviews passed
- Evidence refs:
- Batch 2: db:generate, db:check, 31 unit tests, explicit DB-test skip, Biome, typecheck, Netlify build, and diff-check all exit 0
- Batch 2 independent specification and code-quality re-reviews PASS
- Blocked on: Disposable TEST_DATABASE_URL unavailable; destructive DB integration test remains explicitly skipped
- Next step: Implement Better Auth as sole session owner, idempotent bootstrap, protected admin mutation surface, and safe session projection

## Checkpoint Update

- Current todo: Batch 4: Elysia API foundation, raw transport adapter, and security plugins
- Active slice: Batch 4 API and security foundation
- Completed todos:
- Batch 0: isolated worktree and fresh baseline verification
- Batch 1: tooling, dependencies, Intent allowlist, and deterministic test harness
- Batch 2: environment, Drizzle schema, guarded DB tests, and sole migration
- Batch 3: Better Auth runtime, raw auth surface restrictions, safe session/query owner, transactional bootstrap, and temporary-password helpers; spec and quality reviews passed
- Evidence refs:
- Batch 3: 81 unit tests, explicit DB-test skip, Biome, typecheck, Netlify build, and diff-check all exit 0
- Batch 3 independent spec and quality re-reviews PASS after temporary-password helper remediation
- Blocked on: Disposable TEST_DATABASE_URL unavailable; real bootstrap-twice DB proof remains explicitly unexecuted
- Next step: Implement injected Elysia app, guarded request pipeline, Problem Details, profile/password rotation, audit/rate repositories, raw Start forwarding, and health

## DriftCheckDraft

- Scope status: Batch 3 stayed within Better Auth, bootstrap, safe session/query ownership, and administrator credential helper scope.
- Compatibility status: No Billing, tenancy, legacy compatibility, Dashboard, business API, or alternate session owner added.
- Retirement status: Auth demo remains only as temporary scaffold UI with signup removed and canonical Query session ownership; full demo retirement remains Batch 14.
- New risk signals:
- Disposable DB bootstrap-twice proof remains unexecuted because TEST_DATABASE_URL is absent; transactional seams and idempotency are unit-tested.
- Advisory decision: continue

## DriftCheckDraft

- Scope status: Batch 4 stayed within shared API contracts, Elysia security/API foundation, profile/password flow, raw adapters, health, audit/rate repositories, redaction, and tests.
- Compatibility status: No Dashboard, Billing, tenancy, legacy API/client compatibility, alternate auth/session owner, or program/version feature surface added.
- Retirement status: Generated frontend demos remain deferred to the authenticated shell and final retirement batches; no demo became an API owner.
- New risk signals:
- Password rotation crosses Better Auth and project metadata stores; AGENTS.md records the fail-closed compensation and irreducible simultaneous-outage boundary.
- Live Vite curl verification was unavailable in this runner; equivalent health, unauthenticated API, and raw Request identity contracts plus Netlify build pass.
- Advisory decision: continue

## Checkpoint Update

- Current todo: Batch 6: program management vertical slice
- Active slice: Batch 6 program contracts, repository/domain/API, Query/Table/Form UI, and nested route layout
- Completed todos:
- Batch 0: isolated worktree and fresh baseline verification
- Batch 1: tooling, dependencies, Intent allowlist, and deterministic test harness
- Batch 2: environment, schema, migration, and guarded DB integration harness
- Batch 3: Better Auth, bootstrap, safe session/query ownership, and administrator credential helpers
- Batch 4: Elysia API/security foundation, profile password rotation, raw Start forwarding, health, audit/rate repositories, and redaction; spec and quality reviews passed
- Batch 5: authenticated shell, secure Router guards, forced-password replacement flow, typed localization, accessible Kobalte primitives, responsive navigation, and persistent dynamic tabs; specification and visual/accessibility reviews passed
- Evidence refs:
- Batch 5: 145 unit/contract/component tests, Biome over 109 files, typecheck, Netlify client/SSR build, anonymous real-Router Playwright guard, and diff-check all exit 0
- Batch 5 independent specification and visual/accessibility re-reviews PASS after SSR-boundary, locale-owner, Field ARIA, tab focus/tabpanel, Switch focus-ring, radio-menu, and localized-close fixes
- Blocked on: Disposable TEST_DATABASE_URL remains unavailable, so DB-backed proof is still an explicit skip. Authenticated four-page Playwright coverage is present but requires E2E_ADMIN_EMAIL and E2E_ADMIN_PASSWORD in a seeded environment.
- Next step: Implement the program vertical slice with strict shared contracts, transactional repository/domain rules, Elysia routes, Query client ownership, URL-backed Table/Form UI, and the required programs layout/index split.

## DriftCheckDraft

- Scope status: Batch 5 stayed within the authenticated shell, auth UI, protected route registry, typed localization, responsive navigation, UI primitives, persistent opened tabs, and their tests.
- Compatibility status: No Dashboard, Billing, tenancy, legacy client/API compatibility, program business behavior, or alternate session/cache owner was added.
- Ownership status: Better Auth remains the session owner, Query remains the remote session cache, the authenticated session locale wins until Batch 10 persists profile changes, and TanStack Store owns only client shell state.
- Verification status: Both independent reviews PASS; the remaining credential-gated authenticated browser run is an external environment action rather than an unimplemented test.
- Advisory decision: continue

## Checkpoint Update

- Current todo: Batch 8: direct OSS release uploads
- Active slice: Batch 8 STS policy, object verification, metadata registration, worker hashing, multipart upload, and in-memory upload queue
- Completed todos:
- Batch 0: isolated worktree and fresh baseline verification
- Batch 1: tooling, dependencies, Intent allowlist, and deterministic test harness
- Batch 2: environment, schema, migration, and guarded DB integration harness
- Batch 3: Better Auth, bootstrap, safe session/query ownership, and administrator credential helpers
- Batch 4: Elysia API/security foundation, profile password rotation, raw Start forwarding, health, audit/rate repositories, and redaction
- Batch 5: authenticated shell, secure Router guards, forced-password replacement flow, typed localization, accessible primitives, responsive navigation, and persistent dynamic tabs
- Batch 6: strict program contracts, transactional repository/domain/API behavior, Query/Table/Form UI, guarded DB integration coverage, program-management E2E coverage, and the `programs.tsx` layout plus `programs.index.tsx` leaf split
- Batch 7: strict version/file contracts, canonical semantic-version parsing, transactional repositories/domain rules, nested/global Elysia APIs, app mounting, and guarded database coverage
- Evidence refs:
- Batch 6 program contract fixes page values to `1..1,000,000`, page sizes to `20`/`50`/`100`, literal case-sensitive filtering, and stable `createdAt` plus `id` sorting.
- Batch 6 mutations use opaque weak ETags and `If-Match`; successful delete returns `204` without a response ETag. Unicode code-point limits and bounded control-free well-formed validation paths are covered by the contract boundary.
- Program deletion soft-deletes the program and live versions while preserving file metadata, version-file history, and OSS objects. Successful audits append atomically in the repository; the API plugin owns redacted failure intent and never masks the original response.
- Root gate evidence: `pnpm check` passed over 140 files; `pnpm typecheck` passed; `pnpm test` passed 33 files/218 tests; `pnpm build` produced the Netlify client and SSR function; route generation and `git diff --check` passed.
- Browser/database evidence: `pnpm test:e2e` exited 0 with the anonymous real-Router guard passing; authenticated shell and program CRUD suites skipped without `E2E_ADMIN_EMAIL`/`E2E_ADMIN_PASSWORD`. `pnpm test:db` loaded the guarded harness and skipped 2 files/2 tests without a disposable `TEST_DATABASE_URL`.
- Blocked on: Disposable DB execution requires `TEST_DATABASE_URL` plus `TEST_DATABASE_CONFIRM_DISPOSABLE=updater-admin-destructive-tests`. Authenticated Playwright execution requires seeded `E2E_ADMIN_EMAIL` and `E2E_ADMIN_PASSWORD`; the suites remain explicit credential-gated checks when those values are absent.
- Batch 7 parser accepts canonical numeric `major.minor.patch` only and proves numeric ordering such as `1.10.0 > 1.9.99` within PostgreSQL integer and schema-length bounds.
- Version mutations lock the parent program, distinguish live duplicate conflicts from all-history monotonicity failures, preserve multiple active rows, derive exactly one numeric latest active row, and use ETag/If-Match concurrency.
- Version-file replacement treats omitted IDs as preserve and `[]` as remove-all; file metadata and relations survive soft deletion, while success audits commit atomically with full before/after relation IDs.
- Batch 7 root gate: Biome, typecheck, unit/contract/repository/domain/API/app-integration tests, guarded database harness, Netlify client/SSR build, and diff-check all exit 0. Disposable database execution remains an explicit skip without approved credentials.
- Independent repository and backend re-reviews PASS after correcting duplicate-conflict classification before historical monotonicity.
- Next step: Implement short-lived OSS STS, deterministic object keys, verified idempotent metadata registration, incremental worker hashing, browser-direct multipart upload, and upload queue behavior.

## DriftCheckDraft

- Scope status: Batches 6–7 stayed within program/version/file contracts, persistence/domain/API behavior, program UI, and their database/browser verification seams.
- Compatibility status: No Dashboard, Billing, tenancy, legacy API/client compatibility, automatic OSS deletion, or alternate auth/cache owner was added.
- Ownership status: Elysia remains the business API owner, Drizzle repositories remain the SQL owners, Query remains the remote cache owner, and Better Auth remains the session owner. Repository-owned successful audit append is a documented exception required for transaction atomicity; redacted failure intent remains API-plugin-owned.
- Data-retention status: Soft-deleting a program and its live versions preserves file metadata, relation history, and OSS objects.
- Verification status: Batch 7 passed the root static/unit/build gate; only the explicitly environment-gated disposable-DB execution remains external follow-up evidence for this backend-only slice.
- Advisory decision: continue to Batch 8

## Checkpoint Update

- Current todo: Batch 9: nested version management UI
- Active slice: Query-backed program/version route, upload-to-create orchestration, edit/delete dialogs, and optimistic activation
- Completed todos:
- Batches 0–7: scaffold/tooling, database/auth/API/shell, program management, and version/file backend
- Batch 8: short-lived OSS STS, deterministic destinations, server HEAD verification, atomic idempotent metadata registration, incremental worker hashing, ali-oss multipart upload, and memory-only TanStack Store queue
- Evidence refs:
- Upload requests accept metadata only, enforce canonical relative POSIX paths, lowercase SHA-256, MIME type/subtype grammar, and 1,023 UTF-8-byte OSS keys. The earlier 5 TiB draft limit is superseded by Batch 9's exact 41,943,040,000-byte multipart bound.
- Temporary browser policy contains only `PutObject`, `AbortMultipartUpload`, and `ListParts`; the permanent server principal separately needs prefix-scoped `GetObject` for metadata verification. README documents RAM/CORS and keeps permanent credentials server-only.
- Completion verifies object key, size, and ETag before deterministic lock-ordered repository registration. Matching concurrent replays share IDs; conflicting proofs fail with a sanitized Problem Details response and success audit commits atomically.
- Hashing reads 4 MiB slices in a worker. Multipart upload uses per-file clients, concurrency four, checkpoint/progress/cancel/retry, and required ETag. Files and checkpoints remain in memory; sessionStorage stores only the completed-item display preference.
- Root gate passed `pnpm check` over 184 files, `pnpm typecheck`, 52 test files/337 tests, guarded DB harness with 5 explicit skips, Netlify client/SSR build, and `git diff --check`.
- Independent server, domain/API, and client re-reviews passed after byte-limit, deterministic lock-order, STS outage, credential audit, and MIME fallback hardening.
- Blocked on: Disposable database proof, authenticated Playwright, and optional live OSS smoke require approved external credentials; their guarded/mocked suites are present and passing.
- Next step: Build the nested version page and connect the verified upload foundation to version create/edit flows.

## DriftCheckDraft

- Scope status: Batch 8 stayed within direct release upload, proof registration, browser upload state, security policy, and deployment documentation.
- Compatibility status: No Dashboard, Billing, tenancy, legacy client/API compatibility, file-body proxying, download credentials, or automatic OSS deletion was added.
- Ownership status: Elysia owns upload APIs, Drizzle repositories own metadata/audit writes, OSS stores bodies, Query will own remote version state, and TanStack Store owns only ephemeral upload workflow state.
- Verification status: Root static/unit/build gate and two independent server reviews passed; live DB/OSS/browser environments remain explicit external gates rather than hidden assumptions.
- Advisory decision: continue to Batch 9

## Checkpoint Update

- Current todo: Batch 10: administrator, profile, and account management
- Active slice: Better Auth-owned administrator/session operations, Elysia account APIs, and Query/Table/Form account UI
- Completed todos:
- Batches 0–8: scaffold/tooling, database/auth/API/shell, program/version backends, and direct OSS upload foundation
- Batch 9: nested program-version route, Query-backed version table, explicit folder upload orchestration, create/edit/delete forms, concurrent row activation, and credential-gated end-to-end journey
- Evidence refs:
- The concrete nested route owns program-scoped query/search state and opens a dynamic tab titled from the loaded program name while preserving `/programs` as the pinned fallback.
- Folder selection validates before replacing the queue. Explicit Upload remains disabled until syntactic form validation passes; invalid reselection discards the previous queue so stale files cannot be uploaded accidentally.
- Browser uploads use four file workers, two explicit 4 MiB parts per file, a 10,000-part/41,943,040,000-byte file ceiling, resumable memory-only checkpoints, best-effort multipart abort, and completion chunks of 25.
- Completion uses a two-request per-actor instance cap plus a Neon-backed 2,000-file-token/15-minute budget. Only the distinct missing-object contract can trigger re-upload; conflicts and verification outages remain retryable without overwriting.
- Version activation serializes only the same row, permits unrelated rows concurrently, scopes optimistic snapshots to the target, and invalidates the program list plus exact detail after every rollback.
- The credential-gated Playwright journey uses real Better Auth login and intercepts only `/api/v1` business calls plus realistic ali-oss multipart requests; no product auth/upload test hook exists.
- Batch 9 passed 60 test files/421 tests, Biome, typecheck, Netlify client/SSR build, guarded database harness with five explicit skips, Playwright's anonymous/credential-gated harness, and diff-check. Independent acceptance and security re-reviews PASS after invalid-folder, queued-retry, and activation-rollback remediation.
- Blocked on: Disposable database proof requires `TEST_DATABASE_URL` plus its destructive-test confirmation. Authenticated Playwright requires seeded `E2E_ADMIN_EMAIL`/`E2E_ADMIN_PASSWORD` and a local browser binary. Live OSS verification requires an authorized sandbox.
- Next step: Complete administrator/profile/account management without introducing a second auth/session owner or product RBAC.

## DriftCheckDraft

- Scope status: Batch 9 stayed within nested version UI, browser upload orchestration, completion hardening, version mutations, and their verification seams.
- Compatibility status: No Dashboard, Billing, tenancy, legacy client/API compatibility, file proxying, download credentials, or automatic completed-object deletion was added.
- Ownership status: Better Auth owns identity/session state, Elysia owns business authorization/contracts, Drizzle repositories own SQL/audits, Query owns remote version state, and TanStack Store owns only ephemeral upload state.
- Verification status: Static/unit/build gates and both independent re-reviews pass; live DB/authenticated browser/OSS proof remains explicitly environment-gated.
- Advisory decision: continue to Batch 10

## Checkpoint Update - Batches 10-14 locally verified; external release gates open

- Current todo: Authorized environment provisioning, deployment, and external verification handoff
- Active slice: Local implementation and release verification are complete; only credential/cloud-backed gates remain
- Completed todos:
- Batch 10: Better Auth-owned administrator lifecycle, profile and locale updates, account/session management, TanStack Table/Form UI, and the credential-gated temporary-admin forced-password/revoke/disable journey
- Batch 11: fixed system-settings singleton, ETag/If-Match concurrency, validated defaults and repository URL, Query-backed cache ownership, and stale-write recovery UI
- Batch 12: authenticated readiness and business metrics, renderer-neutral 7/30/90-day release series, append-only filtered audit history/detail, native accessible SVG chart, and URL-backed monitoring/audit pages
- Batch 13: conditional browser/server Sentry, shared recursive scrubbing, Netlify/Start runtime and security-header hardening, conditional source-map upload, environment/deployment documentation, and cross-cutting security verification
- Batch 14: scaffold demo retirement, production route-owner proof for the requested runtime TanStack libraries, durable CLI/Intent toolchain guidance, route/secret/accessibility scans, desktop/mobile Playwright coverage, and credential-gated visual evidence capture paths
- Evidence refs:
- The Batch 13 checkpoint proved 95 test files and 542 tests together with `pnpm check`, `pnpm typecheck`, `pnpm build`, `git diff --check`, and a built Netlify `/health` response carrying the four required dynamic security headers. This is historical Batch 13 evidence, not the final release rerun.
- The final Playwright run proved 8 public desktop/mobile tests passed while 18 authenticated tests skipped explicitly because `E2E_ADMIN_EMAIL` and `E2E_ADMIN_PASSWORD` were absent. This is not proof of the credential-gated journeys.
- The authoritative final local matrix passed frozen offline install, route generation, Intent discovery (10 packages/31 skills), TanStack CLI discovery (16 libraries), Biome over 279 files, TypeScript, 98 Vitest files/568 tests, Drizzle schema check, Netlify client/SSR build, built-function health/security-header smoke, diff-check, and zero-match route/client-secret/source-map scans.
- `pnpm test:db` loaded 6 files/6 tests and explicitly skipped them because no disposable database was authorized. Production route scans returned no `/demo/*`, `/about`, `/dashboard`, `/billing`, or legacy `/api/app/*` matches.
- ADR-0001 records the implemented same-origin TanStack Start/raw Request/Elysia boundary; the baseline already reflects its current owner and compatibility state.
- Blocked on: Disposable database credentials and destructive-test confirmation; seeded E2E administrator credentials; authorized OSS, Sentry, and Netlify Preview environments
- Next step: Provision isolated external environments, run the documented migration/bootstrap/deployment sequence, and attach each external verification result without treating unavailable gates as passes.

## DriftCheckDraft

- Scope status: Batches 10-14 stayed within the approved administrator/settings/monitoring/security/deployment/demo-retirement and release-verification scope.
- Compatibility status: No Dashboard, Billing, tenancy, legacy updater-client/API compatibility, data import, download STS, Sentry Issue ingestion, or automatic OSS deletion was added.
- Ownership status: Better Auth remains the identity/session owner; Elysia remains the business API and authorization owner; Drizzle/Neon own persistence; Query owns remote cache; Router owns URL state; Table/Form own projections and forms; Store owns only cross-component client UI/upload state; Start owns SSR/Netlify transport.
- Retirement status: Scaffold demos and their routes are retired only after real production owners and tests existed; the initial baseline remains historical rather than rewritten.
- Verification status: Local implementation and the authoritative local matrix pass. Credential/database/cloud-backed release evidence remains explicitly open.
- Advisory decision: local-verification-complete-external-gates-open
