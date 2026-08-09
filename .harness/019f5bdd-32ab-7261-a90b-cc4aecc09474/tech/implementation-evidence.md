# T8 implementation evidence

Date: 2026-08-07

## Implemented acceptance surfaces

- `tests/e2e/version-management.spec.ts` now models the current authenticated
  draft lifecycle: draft creation with `expectedFileCount`, bounded resolve,
  file-agnostic STS, draft-scoped completion, finalization, activation,
  metadata edit, and delete. It no longer constructs or asserts `fileIds`,
  per-file credential objects, or the retired global completion route.
- `tests/e2e/version-incremental-upload.spec.ts` and
  `tests/fixtures/version-incremental-upload/**` seed finalized v1 A/B/D and
  select v2 A/B-prime/C. The route fixture classifies unchanged A as reused,
  uploads only changed B-prime and new C, keeps removed D absent, finalizes the
  complete A/B-prime/C manifest, and has a public v2 consumer request signed
  URLs only for B-prime/C.
- The synthetic 10,001-file regression drives the exported upload queue and
  workflow with in-memory one-byte files. It exercises the real 100-item
  resolve and 25-item completion request batching without rendering DOM rows.
- `README.md` and `AGENTS.md` now record the uncapped product contract, bounded
  wire batches, prefix-scoped single-flight STS manager, program-scoped
  HEAD-verified reuse, self-contained finalized manifests, draft lifecycle,
  additive cursor/selective-signing public v2, preserved public v1, and the v2
  updater-client rollout gate.

## Fresh static evidence from this worker

- Repository Biome configuration excludes `tests/**` and Markdown, so the
  direct scoped command reported `Checked 0 files` and named all supplied paths
  as ignored. A temporary Biome 2.4.5 configuration with the repository's tab,
  double-quote, recommended-lint, and organize-import settings was then applied
  only to the three changed TypeScript files. The final run reported:
  `Checked 3 files in 13ms. No fixes applied.`
- `git diff --check -- tests/e2e/version-management.spec.ts
  tests/e2e/version-incremental-upload.spec.ts tests/fixtures README.md AGENTS.md
  .harness/019f5bdd-32ab-7261-a90b-cc4aecc09474/tech` exited 0 with no output.
- Text searches over the three changed TypeScript files, README, and AGENTS
  found no debugging statements, breakpoint statements, work-in-progress
  markers, type-ignore directives, or unsafe-any escape hatches. The only
  remaining `fileIds` text is an AGENTS prohibition against restoring
  full-array replacement.

Per the delegated T8 boundary, this worker did not run tests, TypeScript
typecheck, database checks, build, Playwright, or semantic/LSP diagnostics.
Those commands are not represented here as worker verification.

## Existing build evidence and remaining gates

- The current restricted local production build was reported by orchestration
  to exit 0. Sentry source-map upload failed DNS resolution during that build,
  so Sentry upload/association is not accepted or claimed.
- `pnpm test:db` requires a separately verified disposable
  `TEST_DATABASE_URL` and exact
  `TEST_DATABASE_CONFIRM_DISPOSABLE=updater-admin-destructive-tests`.
- Authenticated Playwright requires `E2E_ADMIN_EMAIL` and
  `E2E_ADMIN_PASSWORD`; all Playwright projects require a host allowed to bind
  the isolated `127.0.0.1` listener (`E2E_PORT` defaults to 3187). The managed
  workspace's loopback restriction still gates browser execution here.
- Real reuse and completion acceptance requires an authorized isolated OSS
  prefix with the server RAM/STS variables, upload CORS exposing `ETag`,
  prefix-level no-overwrite protection, and incomplete-multipart lifecycle
  cleanup. Mocked OSS routes do not satisfy this gate.
- Netlify Preview acceptance requires isolated Preview Neon/OSS/auth/Sentry
  configuration and an authorized real in-app-browser mutation that reaches the
  Function using `X-Updater-If-Match` and returns the next standard `ETag`.
- Sentry acceptance requires network reachability plus the configured DSN,
  token, organization, project, and direct evidence that a scrubbed event maps
  to the uploaded source maps. The observed DNS failure leaves this gate open.
- Before activating a release not safely consumable through public v1, an
  updater client that traverses public v2 cursors, compares the complete
  manifest, selectively requests changed-file URLs, and removes absent paths
  must be shipped through its separately authorized rollout.

## Fresh coordinator verification results

- Attempt 2 scoped temporary-config Biome verification checked the two changed
  TypeScript/fixture modules in 13 ms with no fixes applied.
- `tsc` exited 0.
- Vitest passed 115 files and 669 tests.
- Biome passed 315 files.
- `drizzle-kit check` passed.
- The production build exited 0 and emitted Netlify SSR output. Sentry
  source-map upload failed DNS resolution, so Sentry upload is not claimed.
- The database suite exited 0, but all 8 tests were skipped because the
  disposable database environment was missing.
- `git diff --check` passed.
- Authenticated Playwright E2E was not run because `E2E_ADMIN_EMAIL` and
  `E2E_ADMIN_PASSWORD` were unset. A direct attempt to start the Playwright web
  server failed with `env: node: Permission denied` under the managed runtime;
  no browser success is claimed.
