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
- Temporary browser policy contains only `PutObject` and `AbortMultipartUpload`; retry/resume uses the in-memory client checkpoint without remote reconciliation. The permanent server principal separately needs `sts:AssumeRole` plus prefix-scoped `GetObject` for metadata verification. Bucket lifecycle owns incomplete multipart cleanup. Any authorized sandbox deletion of a completed smoke-test object requires a separate test-only identity; README documents this RAM/CORS boundary and keeps permanent credentials server-only.
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

## Checkpoint Update - External environment validation paused on database safety

- Current todo: Provision two isolated Neon targets before external verification continues
- Active slice: Netlify project provisioning completed; database migration/bootstrap stopped before any reset or destructive test
- Evidence refs:
- Created the blank Netlify E2E project `updater-admin-e2e-019f5bdd32ab7261` with Project ID `f8a4c65a-eebc-4519-8eb8-57964c6f695f`; the ignored worktree `.env.local` contains the ID.
- The application Neon URL accepts WebSocket queries, but the target is not fresh: it already contains two users, six sessions, two programs, one version, two file rows, and one relation row. Its migration ledger reports two entries while `admin_metadata` is absent.
- Bootstrap failed on the missing `admin_metadata` relation before creating an administrator. No schema drop, data reset, or destructive DB suite was run.
- `DATABASE_URL` and `TEST_DATABASE_URL` identify the same database, and the destructive confirmation sentinel is absent, so the guarded DB tests correctly remain blocked.
- The embedded signed Node runtimes cannot load Rolldown's ad-hoc native binding on this Mac. At this historical checkpoint, the direct-Bun rerun completed the client/SSR Netlify build and passed 588/589 tests; the later namespace-import remediation and all-green rerun supersede this result.
- Blocked on: a fresh application Neon branch/database and a second, distinct disposable test branch/database.
- Next step: replace both URLs, keep each connection string on one line, set `TEST_DATABASE_CONFIRM_DISPOSABLE=updater-admin-destructive-tests`, then migrate/bootstrap and resume the in-app-browser plus OSS/Sentry/Preview gates.

## DriftCheckDraft

- Scope status: External validation stayed within the approved Neon, auth, Sentry, OSS, and Netlify gates.
- Data-safety status: The non-empty inconsistent database was inspected read-only after migration/bootstrap failures; no destructive repair was attempted.
- Compatibility status: No Dashboard, Billing, tenancy, legacy compatibility, or alternate persistence owner was introduced.
- Advisory decision: pause-for-user-database-isolation

## Checkpoint Update - External Preview and in-app-browser E2E verified - 2026-07-19

This checkpoint supersedes the database-safety pause above for current state while retaining that first attempt as historical evidence.

- Current todo: Resolve the remaining guarded-database, OSS upload-role/lifecycle/live-smoke, Sentry source-map, and forced-password final-submit gates.
- Active slice: Core nonproduction Preview and actual in-app-browser acceptance are complete.
- Completed todos:
- The user expressly authorized destructive database repair; reset, migration, and bootstrap passed.
- Netlify project `updater-admin-e2e-019f5bdd32ab7261` (`f8a4c65a-eebc-4519-8eb8-57964c6f695f`) has ready deploy `6a5ccba51967b64766b10fce`, titled `tab-retitle-owner-fix`, only on branch alias `codex-e2e-332273d`. Production was never published.
- Public Preview checks passed: `/health` returned 200 with `Permissions-Policy`, `Referrer-Policy`, `X-Content-Type-Options`, `X-Frame-Options`, and HSTS; `/` returned 307 to programs; anonymous `/api/v1/programs` returned 401 `application/problem+json` with `UNAUTHENTICATED`.
- Netlify strips standard request `If-Match` before the Function. The application now sends `X-Updater-If-Match`, keeps standard response `ETag`, and has no fallback/double-read path. Direct authenticated sign-in/GET/PATCH advanced the ETag; standard `If-Match` alone returned 428; real UI edit, delete, and administrator mutations passed.
- Actual Codex in-app-browser flows passed for login/session; program create/filter/reset/edit/delete; nested versions and dynamic-tab persistence; monitoring and audit detail; Chinese/English persistence; system-name update/revert; and administrator disable.
- An intermittent `Tab href must match its registered protected route` error was fixed with stable-key retitle-only behavior, leaving AppShell as the sole navigation owner. A fresh-tab final-deploy retest created a program, opened its nested route, changed `pageSize` from 20 to 50, preserved the exact URL query and program-name tab across hard reload, and produced zero console errors. The test program was deleted and all browser tabs were finalized.
- Focused tests, TypeScript, Biome, and the production build pass. The initial full direct-Bun suite at this checkpoint passed 100/101 files and 588/589 tests; the later namespace-import remediation and 101/101-file, 589/589-test proof supersede this historical result.
- Sentry events/releases reads work. Source maps were not uploaded because source-disclosure approval was absent. The forced-password gate was verified without performing the final credential-changing submit; the temporary administrator was disabled.
- Evidence ref: `docs/aegis/work/2026-07-14-updater-admin-implementation/evidence-bundle-draft-external-preview-e2e-2026-07-19.json`.
- Blocked on:
- Guarded DB verification is partial: 5/6 files and 23/25 tests passed; two `versions.server.db.test.ts` cases timed out after five seconds against remote Neon, and cleanup then hit FK RESTRICT because child version rows remained.
- OSS readiness is abnormal: the temporary upload role lacks required `oss:AbortMultipartUpload`. Browser retry/resume uses only the in-memory checkpoint and never queries remote part state. Incomplete multipart cleanup belongs to the bucket lifecycle rule, while the permanent application principal remains limited to `sts:AssumeRole` plus prefix-scoped `oss:GetObject`. Deleting a completed sandbox smoke-test object, if explicitly authorized, requires a separate test-only identity. Live upload/version creation remains unproven.
- Sentry source-map association requires explicit source-disclosure approval.
- Browser automation intentionally did not perform the final forced-password-changing submit.
- Next step: Remediate and rerun the two failing guarded DB cases, add only `oss:AbortMultipartUpload` to the temporary upload role, configure/verify lifecycle cleanup, and run a sandbox multipart smoke using a separate explicitly authorized test identity only if the completed test object must be deleted; obtain source-map disclosure approval if association proof is required, and have an authorized human complete the forced-password final submit if that proof is required.

## DriftCheckDraft - 2026-07-19 superseding status

- Scope status: The authorized database repair, nonproduction Netlify deployment, optimistic-concurrency remediation, dynamic-tab ownership fix, and in-app-browser verification stayed within the approved release scope.
- Compatibility status: No Dashboard, Billing, tenancy, legacy API/client compatibility, or standard-`If-Match` fallback was introduced.
- Ownership status: AppShell remains the sole tab open/activate navigation owner; the version route can only retitle an existing stable-key tab. Elysia remains the business API owner and standard `ETag` remains the response validator.
- Verification status: Core Preview and actual browser flows pass; the guarded DB suite is partial and the three provider/security gates remain explicit.
- Advisory decision: external-preview-core-passed-residual-verification-failures-open

## Checkpoint Amendment - Guarded database gate passed - 2026-07-19

This amendment supersedes the partial guarded-database result in the immediately preceding checkpoint while preserving it as the first remediation attempt.

- `vitest.db.config.ts` now applies bounded 30-second test and hook timeouts. This accommodates measured remote-Neon transaction and cleanup latency without allowing unbounded hangs.
- `versions.server.db.test.ts` passed all 6 tests on three consecutive runs: 35.20s, 28.22s, and 27.47s.
- The complete guarded suite passed 6/6 files and 25/25 tests in 61.56s.
- Exact post-suite verification found zero rows in each of all 13 approved tables.
- Recovery passed: migrations were applied, a one-time high-entropy nonproduction bootstrap administrator was created without persisting or disclosing its password, `/health` returned 200 `application/json`, and anonymous `/api/v1/programs` returned 401 `application/problem+json` with `UNAUTHENTICATED`.
- Current todo: Resolve only the OSS upload-role/lifecycle/live-smoke gate, explicit Sentry source-map disclosure approval, and the human forced-password final-submit boundary.
- Current advisory decision: external-preview-core-passed-residual-security-gates-open

## Checkpoint Amendment - Unit gate, OSS least privilege, and latest Preview - 2026-07-19

- The Zod runtime gate now uses the direct module namespace without changing its `coerce`/metadata assertion. Test-only `@tanstack/solid-start` inlining keeps Solid Router JSX inside the Vite/Vitest transform pipeline.
- Literal `pnpm test` under standard Node 22.23.1 passed 101/101 files and 589/589 tests in 29.66s; the complete Bun fallback independently passed 101/101 files and 589/589 tests.
- The temporary OSS role was narrowed to prefix-scoped `oss:PutObject` plus `oss:AbortMultipartUpload`. Unused `oss:ListParts` was removed from source, tests, and guidance; retry/resume remains checkpoint-only.
- Latest ready nonproduction deploy is `6a5ce3d089887ba14c119407`, titled `least-privilege-oss-node-test-fix-rebundle`, on alias `codex-e2e-332273d`. Production was never published.
- Against that final deploy, the Codex in-app browser rendered the protected-root login redirect with zero console errors, observed `/health` as `application/json` with `{"status":"ok"}`, and observed anonymous `/api/v1/programs` as 401 `application/problem+json` with `UNAUTHENTICATED`. All browser tabs were then closed.

## Checkpoint Amendment - Sentry source-map association passed - 2026-07-20

This amendment supersedes the open Sentry approval/association gate above while retaining the earlier statements as historical evidence.

- The user explicitly approved uploading source maps to the configured Sentry project.
- The first authorized upload exposed a multi-stage build defect: Sentry's Vite plugin deleted `dist/**/*.map` during an earlier TanStack/Netlify build environment, after which a later environment uploaded source-only artifacts for the same debug IDs. `filesToDeleteAfterUpload` was removed from the environment-scoped plugin; the top-level build now runs `scripts/remove-source-maps.mjs` only after all Vite environments and uploads succeed.
- The repaired build produced 153 hidden maps before cleanup. Sentry accepted complete artifact bundle `4d712dfc-e2e0-54a6-a122-d8564eedba27` with 304 files. Both browser debug ID `16dcb119-ef23-44c4-a303-78f415db0e3b` and server debug ID `4dd85e44-de99-4f73-b8b0-3008f7e69a8d` have paired JavaScript and map files in that bundle.
- Post-upload cleanup reduced the local `dist` map count to zero while retaining both debug IDs. On the deployed alias, `/assets/client-AwLcjBtf.js` returns 200 and `/assets/client-AwLcjBtf.js.map` returns 404.
- Netlify deploy `6a5d7460187ccd05113f28e7`, titled `sentry-sourcemap-upload-verified`, is ready only on alias `codex-e2e-332273d`; production was never published.
- The Codex in-app browser rendered the login page with zero console events, observed `/health` 200 JSON and anonymous `/api/v1/programs` 401 Problem Details, and then triggered a read-only anonymous API failure through the deployed compiled API client. Sentry event `3359719d22b9454690cdb85dd7199ac5` on release `updater-admin-e2e-332273d` has an empty processing-error list and resolves to `src/lib/api/client.ts` lines 399 and 383.
- Current todo: Resolve only the OSS upload-role/lifecycle/live-smoke gate and the human forced-password final-submit boundary.
- Current advisory decision: external-preview-and-sentry-passed-residual-security-gates-open

## Checkpoint Amendment - Live OSS and final in-app-browser E2E - 2026-07-20

This amendment supersedes the open live-OSS and forced-password bullets above while preserving the earlier attempts as diagnostic history.

- The authorized test account completed the forced-password journey and was used only for the nonproduction acceptance run.
- Direct provider proof passed: permanent credentials assumed the configured upload role; multipart initiation, one-part upload, and `AbortMultipartUpload` all returned success under the prefix-scoped temporary policy. No completed object was deleted and neither application identity received `DeleteObject`.
- The first live browser upload exposed a server packaging defect. `createRequire("ali-oss")` was not visible to Netlify NFT, so the Function ZIP contained the package manifest but omitted `lib/client.js`; `/api/v1/uploads/complete` therefore returned 503. The server now uses a static import with an interop resolver, targeted tests pass, and the rebuilt ZIP contains the SDK entry and dependency graph.
- On deploy `6a5d91653c4efdfb5a6ee569`, the Codex in-app browser retried completion and observed HTTP 200. It then created version `1.0.0` with HTTP 201. Neon verification found one live relation to the expected 303-byte file, a nonempty ETag, the exact canonical object key, and the active version state.
- Real-browser activation testing then exposed that the library-backed switch rendered a hidden input whose visible control could be obscured by the sticky action column. The switch was replaced with a native accessible button (`role="switch"`); focused tests, TypeScript, Sentry-uploading production build, and map cleanup passed. Final deploy `6a5d95ea2c8afd55c56dc095` returned HTTP 200 for activation and the UI showed `1.0.0` as active/latest with no browser warning/error logs.
- OSS accepted the browser multipart request, but bucket CORS did not expose the response `ETag`. The designed server-HEAD retry recovered without re-uploading. An environment operator should add `ETag` to the existing CORS rule's exposed headers for the one-step path. The application principal received 403 for read-only bucket lifecycle/CORS inspection as expected; verify incomplete-multipart lifecycle separately rather than widening the runtime role.
- Production was never published. The completed E2E object remains intentionally preserved under `updater-admin-e2e/`.
- Current advisory decision: live-application-e2e-passed-bucket-configuration-follow-up-open

## Checkpoint Amendment - Public release API Preview passed; production gated - 2026-07-20

- The anonymous read-only `/api/public/v1` latest and specified active-release contract is implemented without changing administrator authorization. Public manifests are capped at 256 version files, and the domain signs individual 300-second GET URLs with at most eight signer calls in flight while preserving response order.
- The first live query exposed an invalid derived-table column reference. The repository now binds the outer query to the selected-release SQL aliases explicitly, and the public API passed Preview verification after that fix.
- The authoritative corrected Preview deploy ID is `6a5daddfadd194231b14ea70`. It is nonproduction; no production publish is claimed. Source maps were not uploaded for this latest Preview, so the earlier Sentry association applies only to its historical build and does not cover this deploy.
- Formal Netlify Site `180cc440-4b2f-4313-867d-d33146376287` with canonical domain `https://updater-admin-019f5bdd32ab7261.netlify.app` now exists, but it has no production deploy.
- Exact read-only E2E cleanup enumeration is recorded in `docs/aegis/plans/2026-07-20-production-e2e-cleanup-manifest.md`. It preserves non-target rows, settings, migrations, and OSS objects and does not authorize deletion or administrator bootstrap.
- Production remains blocked on the Netlify plan restriction for required deploy-context secret scoping, explicit confirmation of the exact E2E database cleanup plus intended production administrator bootstrap, and fresh informed approval before uploading source maps for the current candidate.
- Current advisory decision: public-api-preview-passed-production-publication-blocked

## Checkpoint Amendment - Production authorization and read-only preflight - 2026-07-20

- The operator confirmed the exact cleanup manifest, production administrator identity, and production Sentry source-map upload.
- A fresh production Neon read-only preflight matched every fixed row and all 18 audit IDs, found no unlisted logical dependencies, and found the optional rate window already expired. Settings and migration fingerprints were captured; no write or OSS action occurred.
- Destructive execution remains paused until the operator adds an operator-known `BOOTSTRAP_ADMIN_PASSWORD` to ignored `.env.local`. Independent review rejected generating or logging a password inside the cleanup command because a crash could lose it and cleanup output must not disclose credentials.
- Netlify's current team plan still blocks the explicit variable scopes required by Secrets Controller. Continue after the operator upgrades the team and marks the production values as scoped secrets.
- Current advisory decision: production-preflight-passed-waiting-secret-controller-and-bootstrap-password

## Checkpoint Amendment - Formal production published and verified - 2026-08-06

- Netlify capability correction: the formal Site's Free account supports Secrets Controller (`env_var_secrets=true`). A reversible secret probe was created, observed masked, and deleted. Only granular scope selection is unavailable; no plan upgrade was required for masked production secrets.
- Production configuration: 19 Production-context variables are present. Five credential values are write-only secrets; bootstrap, disposable-test, and Netlify access credentials are not deployed.
- Database maintenance: the guarded preflight matched the exact manifest. The serializable execute step deleted one temporary program, version, file, relation, user, account, administrator metadata row, all 18 audit rows, and zero already-expired rate rows. Settings and migration fingerprints remained unchanged.
- Identity: Better Auth bootstrapped the intended `admin` account. Database verification found one user, one credential account, one administrator metadata row, and zero sessions before browser login.
- Release: migrations were already current; Biome checked 299 files, TypeScript passed, and Vitest passed 108 files/641 tests. The production build uploaded Sentry artifact bundle `646a6712-fff7-5856-a9bb-a12247086e52` for release `332273de028fc8faca34e9058cee0d55bc0b33fc`; the deploy artifact contains zero `.map` files.
- Deployment: formal production deploy `6a73ec801b96527dc4878d85` is live at `https://updater-admin-019f5bdd32ab7261.netlify.app`.
- HTTP/public API: health 200, anonymous administrator API 401, missing public release 404, allowed-origin preflight 204, and rejected-origin preflight 403 passed. A temporary active release proved both public manifest routes return 200 without authentication and its signed OSS URL downloads the expected 303-byte SHA-256-matching object. Exact fixture cleanup restored zero business rows and the test URL to 404.
- Actual browser E2E: the Codex in-app browser passed protected redirect, production-admin login, empty program table, administrator listing, dynamic-tab persistence, monitoring/provider readiness, chart-range filter, audit, system settings, language/account menus, logout, and zero console warnings/errors.
- Current advisory decision: formal-production-published-and-verified
