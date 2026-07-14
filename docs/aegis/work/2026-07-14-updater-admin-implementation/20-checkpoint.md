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

- Current todo: Batch 7: semantic-version and file-relation backend rules
- Active slice: Batch 7 shared version/file contracts, semantic-version parser, repositories/domain rules, and nested Elysia APIs
- Completed todos:
- Batch 0: isolated worktree and fresh baseline verification
- Batch 1: tooling, dependencies, Intent allowlist, and deterministic test harness
- Batch 2: environment, schema, migration, and guarded DB integration harness
- Batch 3: Better Auth, bootstrap, safe session/query ownership, and administrator credential helpers
- Batch 4: Elysia API/security foundation, profile password rotation, raw Start forwarding, health, audit/rate repositories, and redaction
- Batch 5: authenticated shell, secure Router guards, forced-password replacement flow, typed localization, accessible primitives, responsive navigation, and persistent dynamic tabs
- Batch 6: strict program contracts, transactional repository/domain/API behavior, Query/Table/Form UI, guarded DB integration coverage, program-management E2E coverage, and the `programs.tsx` layout plus `programs.index.tsx` leaf split
- Evidence refs:
- Batch 6 program contract fixes page values to `1..1,000,000`, page sizes to `20`/`50`/`100`, literal case-sensitive filtering, and stable `createdAt` plus `id` sorting.
- Batch 6 mutations use opaque weak ETags and `If-Match`; successful delete returns `204` without a response ETag. Unicode code-point limits and bounded control-free well-formed validation paths are covered by the contract boundary.
- Program deletion soft-deletes the program and live versions while preserving file metadata, version-file history, and OSS objects. Successful audits append atomically in the repository; the API plugin owns redacted failure intent and never masks the original response.
- Root gate evidence: `pnpm check` passed over 140 files; `pnpm typecheck` passed; `pnpm test` passed 33 files/218 tests; `pnpm build` produced the Netlify client and SSR function; route generation and `git diff --check` passed.
- Browser/database evidence: `pnpm test:e2e` exited 0 with the anonymous real-Router guard passing; authenticated shell and program CRUD suites skipped without `E2E_ADMIN_EMAIL`/`E2E_ADMIN_PASSWORD`. `pnpm test:db` loaded the guarded harness and skipped 2 files/2 tests without a disposable `TEST_DATABASE_URL`.
- Blocked on: Disposable DB execution requires `TEST_DATABASE_URL` plus `TEST_DATABASE_CONFIRM_DISPOSABLE=updater-admin-destructive-tests`. Authenticated Playwright execution requires seeded `E2E_ADMIN_EMAIL` and `E2E_ADMIN_PASSWORD`; the suites remain explicit credential-gated checks when those values are absent.
- Next step: Implement Batch 7 semantic-version parsing, transactional version/file-relation behavior, list/detail/mutation contracts, latest-active selection, and nested Elysia version/file APIs.

## DriftCheckDraft

- Scope status: Batch 6 stayed within program contracts, program persistence/domain/API behavior, Query/Table/Form UI, program routes, and their database/browser verification seams.
- Compatibility status: No Dashboard, Billing, tenancy, legacy API/client compatibility, automatic OSS deletion, or alternate auth/cache owner was added.
- Ownership status: Elysia remains the business API owner, Drizzle repositories remain the SQL owners, Query remains the remote cache owner, and Better Auth remains the session owner. Repository-owned successful audit append is a documented exception required for transaction atomicity; redacted failure intent remains API-plugin-owned.
- Data-retention status: Soft-deleting a program and its live versions preserves file metadata, relation history, and OSS objects.
- Verification status: Batch 6 passed the root static/unit/build/browser gate; only the explicitly environment-gated disposable-DB and authenticated-browser executions remain external follow-up evidence.
- Advisory decision: continue to Batch 7
