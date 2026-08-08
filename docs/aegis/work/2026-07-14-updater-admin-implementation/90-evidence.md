# Updater Admin Implementation - Evidence

Verification evidence is appended by completed implementation batch.

## EvidenceBundleDraft

- Artifact key: batch0-baseline
- Type: command-suite
- Source: pnpm intent:list; pnpm check; pnpm typecheck; pnpm test; pnpm build
- Summary: Intent discovered 10 packages/31 skills; Biome, TypeScript, scaffold Vitest, and Netlify production build exited 0; Vitest currently has no files as recorded baseline
- Verifier: root agent fresh command outputs 2026-07-14

## EvidenceBundleDraft

- Artifact key: batch0-worktree
- Type: verification
- Source: pnpm install --frozen-lockfile; pnpm check; pnpm typecheck; pnpm test; pnpm build
- Summary: Fresh isolated implementation worktree passed frozen install, Biome check, TypeScript typecheck, baseline Vitest invocation, and Netlify production build; baseline test had no test files and is explicitly not treated as coverage.
- Verifier: root

## EvidenceBundleDraft

- Artifact key: batch8-uploads
- Type: verification
- Source: pnpm check; pnpm typecheck; pnpm test; pnpm test:db; pnpm build; git diff --check
- Summary: Batch 8 passed Biome over 184 files, TypeScript, 337 unit/contract/repository/domain/API/component tests across 52 files, the guarded disposable-database harness, the Netlify client and SSR production build, and diff-check. Five destructive database suites explicitly skipped without TEST_DATABASE_URL. Independent server, domain/API, and client reviews passed after fixes for server-only OSS read permission, canonical lock order, 1,023-byte object keys, pre-STS validation, stable provider-outage mapping, credential success auditing, and MIME grammar/fallback.
- Verifier: root

## EvidenceBundleDraft

- Artifact key: batch1-tooling
- Type: verification
- Source: pnpm install --frozen-lockfile --offline; pnpm intent:list; pnpm check; pnpm typecheck; pnpm test; pnpm exec playwright install --dry-run; pnpm build; git diff --check
- Summary: Batch 1 passed the full tooling gate with a real 2-test Solid/jsdom suite, an explicit Intent allowlist, serial DB-test config, isolated Playwright E2E discovery, and successful Netlify production output. Independent specification and code-quality reviews passed after fixes.
- Verifier: root

## EvidenceBundleDraft

- Artifact key: batch9-versions-ui
- Type: verification
- Source: focused Vitest; pnpm check; pnpm typecheck; pnpm test; pnpm test:db; pnpm test:e2e; pnpm build; git diff --check
- Summary: Batch 9 passed 60 test files/421 tests, Biome, TypeScript, the guarded disposable-database harness, Playwright's anonymous and credential-gated projects, the Netlify client/SSR build, and diff-check. Five destructive database suites explicitly skipped without TEST_DATABASE_URL; the authenticated version journey skipped without seeded credentials. Independent acceptance and security re-reviews passed after fixing invalid folder reselection, discarded queued retries, and post-rollback cache refresh.
- Verifier: root

## EvidenceBundleDraft

- Artifact key: batch2-database
- Type: verification
- Source: pnpm db:generate; pnpm db:check; pnpm test; pnpm test:db; pnpm check; pnpm typecheck; pnpm build; git diff --check
- Summary: Batch 2 passed schema generation/check, 31 unit tests, Biome, TypeScript, Netlify production build, and diff-check. DB integration was explicitly skipped without TEST_DATABASE_URL. Guard probes reject missing confirmation and pooled/direct production aliases before connection. Independent spec and quality reviews passed.
- Verifier: root

## EvidenceBundleDraft

- Artifact key: batch3-auth
- Type: verification
- Source: pnpm test; pnpm test:db; pnpm check; pnpm typecheck; pnpm build; git diff --check
- Summary: Batch 3 passed 81 unit tests, Biome, TypeScript, Netlify production build, and diff-check. Database suite explicitly skipped without TEST_DATABASE_URL. Disabled Better Auth HTTP mutation routes, safe session projection, transactional bootstrap, and transaction-bound temporary-password create/reset helpers were independently reviewed; spec and quality reviews passed after remediation.
- Verifier: root

## EvidenceBundleDraft

- Artifact key: batch4-api
- Type: verification
- Source: pnpm test; pnpm test:db; pnpm check; pnpm typecheck; pnpm build; git diff --check
- Summary: Batch 4 passed 116 unit/contract tests, Biome, TypeScript, Netlify production build, and diff-check. Database suite explicitly skipped without TEST_DATABASE_URL. Health/raw-forwarding contracts cover the local curl behavior because Vite did not bind in this runner. Independent spec and security reviews passed after fixing reporter isolation, fail-closed password partial success, exact shape assertions, validation bounds, redactor policy fields, and trailing-slash rate-limit normalization.
- Verifier: root

## EvidenceBundleDraft

- Artifact key: batch10-administrator-profile-account
- Type: implementation-evidence
- Source: administrator/profile/account contracts, repositories, Elysia modules, Query/Table/Form UI, component/contract coverage, and credential-gated Playwright flow
- Summary: Batch 10 implements list/create/update/reset/revoke administrator operations without exposing identity secrets; Better Auth remains the identity, password, ban, and session owner. The UI covers administrator filters/dialogs, profile locale/name, account password/session actions, temporary-password enforcement, focus restoration, and secret-safe projections. The real bootstrap-admin -> temporary-admin -> forced password rotation -> bootstrap-admin -> revoke/disable Playwright path exists but remains part of the 18 credential-gated skips until seeded credentials are supplied.
- Verifier: root final matrix 2026-07-15

## EvidenceBundleDraft

- Artifact key: batch11-system-settings
- Type: implementation-evidence
- Source: system-settings contracts, singleton repository/domain/API, TanStack Form page, Query cache helpers, stale-write tests, and Playwright fixture coverage
- Summary: Batch 11 implements the fixed settings singleton with system name, default locale, default page size, and optional HTTPS repository URL. Mutations require the current weak ETag, normalize nullable input, refresh exact Query state after stale writes, and do not introduce a second persistent settings store.
- Verifier: root final matrix 2026-07-15

## EvidenceBundleDraft

- Artifact key: batch12-monitoring-audit
- Type: implementation-evidence
- Source: monitoring/audit contracts, repositories, domain/API modules, Query/Table pages, native SVG chart, component/contract coverage, and Playwright fixture coverage
- Summary: Batch 12 implements authenticated readiness/business summaries, 7/30/90-day renderer-neutral release series, filtered append-only audit history/detail, recent operations, and an accessible native SVG chart with a tabular text alternative. The final aggregate local matrix passed after late review remediation.
- Verifier: root final matrix 2026-07-15

## EvidenceBundleDraft

- Artifact key: batch13-security-deployment
- Type: historical-verification
- Source: pnpm check; pnpm typecheck; pnpm test; pnpm build; git diff --check; built Netlify function smoke
- Summary: The Batch 13 checkpoint proved 95 test files and 542 tests, static checks, TypeScript, the Netlify production build, diff-check, and a built `/health` response with the four required security headers. It also covered conditional Sentry initialization/upload, recursive redaction, Router/SSR/Query reporting boundaries, Netlify runtime integration, and secret/source-map scans. These counts belong to Batch 13 and are not the final release count.
- Verifier: Batch 13 security review

## EvidenceBundleDraft

- Artifact key: batch14-retirement-release-candidate
- Type: completion-candidate
- Source: route and secret scans; Playwright desktop/mobile projects; screenshot capture paths; pnpm test:e2e; final root matrix pending
- Summary: Scaffold demo routes/components are retired after production owners were established for Start, Router, Query, Table, Form, and Store, while CLI and Intent remain represented by project scripts, metadata, and durable guidance. The final Playwright run proved 8 public desktop/mobile tests passed and 18 authenticated tests were explicitly credential-gated skips; therefore forced-password, real CRUD, authenticated tab persistence, and captured visual artifacts remain external evidence rather than implied passes. The final local static/unit/build/scan matrix passed.
- Verifier: root final matrix 2026-07-15

## EvidenceBundleDraft

- Artifact key: batch10-14-final-local-release-matrix
- Type: local-verification
- Source: pnpm install --frozen-lockfile --offline; pnpm generate-routes; pnpm intent:list; pnpm tanstack:libs; pnpm check; pnpm typecheck; pnpm test; pnpm test:db; pnpm db:check; pnpm test:e2e; pnpm build; built Netlify handler smoke; route/client-secret/source-map scans; git diff --check; Aegis workspace check
- Summary: The stable final worktree passed frozen install, route generation, Intent discovery of 10 packages/31 skills, TanStack CLI discovery of 16 libraries, Biome over 279 files, TypeScript, 98 Vitest files/568 tests, Drizzle schema check, Netlify client/SSR build, `/health` status 200 with all four dynamic security headers, route retirement, client-secret and source-map scans, diff-check, and ADR workspace validation. Playwright passed 8 public desktop/mobile tests and explicitly skipped 18 authenticated tests without seeded credentials. The guarded DB harness loaded 6 files/6 tests and explicitly skipped all 6 without an authorized disposable database.
- Verifier: root 2026-07-15

## External Evidence Gates

- Not run — disposable database: provide an approved `TEST_DATABASE_URL` and `TEST_DATABASE_CONFIRM_DISPOSABLE=updater-admin-destructive-tests`, then rerun the 6 guarded database tests.
- Not run — authenticated E2E and visuals: seed `E2E_ADMIN_EMAIL` and `E2E_ADMIN_PASSWORD`, run all 18 gated browser cases, and retain the 1920px/390px screenshot artifacts.
- Not run — live OSS: use an authorized least-privilege sandbox to verify STS readiness and a small multipart upload without production-object deletion or broader application RAM permissions. If the completed test object must be removed, use a separate explicitly authorized test-only identity scoped to that sandbox prefix.
- Not run — live Sentry: use authorized browser/server DSNs and build credentials to verify one scrubbed event and source-map association.
- Not run — Netlify Preview: deploy after explicit migration and verify login, liveness, protected redirect, API 401, session cookie, Neon readiness, OSS readiness, and dynamic security headers.

## External Environment Attempt - 2026-07-19

- Netlify project provisioning: passed. Created `updater-admin-e2e-019f5bdd32ab7261` with Project ID `f8a4c65a-eebc-4519-8eb8-57964c6f695f` and recorded it only in the ignored worktree environment file.
- Application database readiness: blocked. The supplied Neon database is non-empty and its schema disagrees with its migration ledger (`admin_metadata` is missing while application/auth data already exists).
- Bootstrap: failed closed before administrator creation because the required metadata relation is missing.
- Destructive DB verification: not run. The application and test URLs identify the same database and the confirmation sentinel is absent.
- Local runtime workaround at this first attempt: the direct-Bun rerun produced the Netlify client/SSR build and passed 588/589 tests; the remaining test exercised the `z` convenience-alias interop path under Bun/Vitest. This historical result is superseded by the all-green namespace-import rerun below. The app-bundled signed Node still cannot load Rolldown's ad-hoc macOS binding on this host.
- Safety decision: no schema reset, table drop, data deletion, authenticated browser mutation, OSS upload, Sentry event, or Netlify deploy was attempted after the database inconsistency was proven.

## External Evidence - Authorized repair and nonproduction Preview - 2026-07-19

This evidence supersedes the blocked current-state conclusion of the first 2026-07-19 attempt above without rewriting that historical safety record.

- Database preparation: after the user expressly authorized destructive table/schema repair, reset, migration, and administrator bootstrap passed.
- Guarded database suite: not passed. The authorized rerun passed 5/6 files and 23/25 tests. Two `versions.server.db.test.ts` cases hit their five-second timeout against remote Neon; cleanup then failed with FK RESTRICT because child version rows from the timed-out work remained.
- Netlify target: `updater-admin-e2e-019f5bdd32ab7261`, Project ID `f8a4c65a-eebc-4519-8eb8-57964c6f695f`.
- Ready deploy: `6a5ccba51967b64766b10fce`, title `tab-retitle-owner-fix`, branch alias `codex-e2e-332273d`, URL `https://codex-e2e-332273d--updater-admin-e2e-019f5bdd32ab7261.netlify.app`.
- Deployment boundary: nonproduction branch alias only; production was never published.
- Public HTTP evidence: `/health` returned 200 with `Permissions-Policy`, `Referrer-Policy`, `X-Content-Type-Options`, `X-Frame-Options`, and HSTS. `/` returned 307 to programs. Anonymous `/api/v1/programs` returned 401 `application/problem+json` with `UNAUTHENTICATED`.
- Optimistic-concurrency evidence: Netlify removes standard request `If-Match` before the Function. Requests now use `X-Updater-If-Match`, responses keep standard `ETag`, and no fallback/double-read path exists. Direct authenticated sign-in, GET, and PATCH passed with an ETag advance; standard `If-Match` alone returned 428. Actual UI program edit/delete and administrator mutation passed.
- Browser evidence: the Codex in-app browser passed login/session; program create, filter, reset, edit, and delete; nested version routing and dynamic-tab persistence; monitoring and audit detail; Chinese/English persistence; system-name update/revert; and administrator disable.
- Dynamic-tab remediation: the intermittent `Tab href must match its registered protected route` error was traced to a second route-level navigation owner. The route now retitles an existing tab by stable key and AppShell remains the sole open/activate owner. Against the final deploy, a fresh tab created a program, opened the nested route, changed `pageSize` from 20 to 50, preserved the exact query and dynamic program-name tab across hard reload, and produced zero console errors. The program was deleted and all browser tabs were finalized.
- Local evidence at this checkpoint: focused tests, TypeScript, Biome, and production build passed, while the first full direct-Bun suite was 100/101 files and 588/589 tests. This historical result is superseded by the all-green namespace-import rerun below.
- Evidence bundle: `docs/aegis/work/2026-07-14-updater-admin-implementation/evidence-bundle-draft-external-preview-e2e-2026-07-19.json`.

## Remaining External Evidence Gates - 2026-07-19

- Failed partial — guarded database suite: remediate the two remote-Neon version-test timeouts and make cleanup reliable after a timed-out child insert, then rerun all six files.
- Blocked — live OSS upload/version/lifecycle verification: the temporary upload role lacks required `oss:AbortMultipartUpload`; browser retry/resume uses only the in-memory checkpoint and performs no remote reconciliation. Incomplete multipart cleanup belongs to the bucket lifecycle rule; the permanent application principal must remain limited to `sts:AssumeRole` plus prefix-scoped `oss:GetObject`. A completed sandbox test object may be deleted only by a separate explicitly authorized test identity. OSS readiness is abnormal and no live upload/version creation is claimed.
- Blocked — Sentry source maps: events/releases reads work, but source maps were not uploaded because source-disclosure approval was not provided.
- Intentionally not performed — forced-password final submit: the gate was reached and verified, but browser automation did not perform the irreversible credential-changing submit; the temporary administrator was disabled.

## Guarded Database Superseding Evidence - 2026-07-19

The failed-partial database bullet above is retained as historical evidence of the first rerun and is superseded by this result.

- Harness remediation: `vitest.db.config.ts` uses bounded 30-second test and hook timeouts for measured remote-Neon transaction and cleanup latency; the bound avoids converting slow external I/O into an unbounded wait.
- Stability proof: `versions.server.db.test.ts` passed 6/6 tests three consecutive times in 35.20s, 28.22s, and 27.47s.
- Full proof: the guarded database suite passed 6/6 files and 25/25 tests in 61.56s.
- Cleanup proof: exact post-suite counts were zero for every one of the 13 approved tables.
- Recovery proof: migrations were applied and a one-time high-entropy nonproduction bootstrap administrator was recreated without persisting or disclosing its password.
- Final recovery smoke: public `/health` returned 200 `application/json`; anonymous `/api/v1/programs` returned 401 `application/problem+json` with `UNAUTHENTICATED`.
- Unit-suite remediation: `src/server/auth/zod-runtime.test.ts` now imports the Zod module namespace directly (`import * as z from "zod"`) instead of relying on Zod's `z` convenience alias. The assertion remains unchanged and still proves the Zod 4 `coerce` and metadata APIs used by Better Auth.
- Full unit proof: `vitest.config.ts` now inlines the externalized `@tanstack/solid-start` parent so its Solid Router `.jsx` dependency remains in the Vite/Vitest transform pipeline. With a standard standalone Node 22.23.1 first in `PATH`, literal `pnpm test` passed 101/101 files and 589/589 tests in 29.66s. The final direct-Bun suite also passed 101/101 files and 589/589 tests in 48.82s, with independent all-green runs under both runtimes. The app-bundled Team-ID-signed Node remains a host-specific pre-collection limitation, not the verification runtime.
- Least-privilege OSS follow-up: the temporary browser policy now contains only prefix-scoped `oss:PutObject` and `oss:AbortMultipartUpload`; unused `oss:ListParts` was retired from source, tests, and guidance. Retry/resume remains checkpoint-only, lifecycle owns incomplete multipart cleanup, and completed sandbox-object cleanup remains isolated to a separately authorized test identity.
- Latest Preview: deploy `6a5ce3d089887ba14c119407`, titled `least-privilege-oss-node-test-fix-rebundle`, is ready on the same nonproduction alias. A prebuilt scratch packaging attempt produced a 502 and was immediately superseded by a full-dependency rebundle. The Codex in-app browser then verified the protected-root redirect and rendered login page with zero console errors, `/health` returned `{"status":"ok"}` as `application/json`, and anonymous `/api/v1/programs` returned 401 `application/problem+json` with `UNAUTHENTICATED`. Production was never published.
- Current remaining gates are only the OSS upload-role/lifecycle/live-smoke verification, Sentry source-map disclosure approval/association, and the human forced-password final submit.

## Sentry Source-map Superseding Evidence - 2026-07-20

The blocked Sentry bullet above is retained as historical evidence and is superseded by this authorized result.

- Authorization: the user explicitly approved uploading source maps to the configured Sentry project.
- Root-cause remediation: TanStack Start and the Netlify adapter run multiple Vite build environments. Environment-scoped `filesToDeleteAfterUpload` removed maps before the final upload and allowed a later source-only artifact to supersede a complete debug-ID association. The plugin no longer deletes maps; `pnpm build` invokes `scripts/remove-source-maps.mjs` only after Vite and all uploads succeed.
- Upload proof: the repaired build generated 153 hidden maps. Sentry artifact bundle `4d712dfc-e2e0-54a6-a122-d8564eedba27` contains 304 files. Browser debug ID `16dcb119-ef23-44c4-a303-78f415db0e3b` and server debug ID `4dd85e44-de99-4f73-b8b0-3008f7e69a8d` each resolve to a JavaScript file plus its map.
- Disclosure boundary: post-upload cleanup left zero maps under `dist`. The nonproduction alias returns 200 for `/assets/client-AwLcjBtf.js` and 404 for `/assets/client-AwLcjBtf.js.map`; source maps are available to Sentry but are not public deployment assets.
- Deployment proof: Netlify deploy `6a5d7460187ccd05113f28e7`, titled `sentry-sourcemap-upload-verified`, is ready only on alias `codex-e2e-332273d`. Production was never published.
- Browser/runtime proof: the Codex in-app browser rendered login with zero console events, returned `/health` 200 JSON and anonymous `/api/v1/programs` 401 Problem Details, and generated a controlled read-only `ApiProblemError` through the actual deployed API-client module.
- Association proof: Sentry event `3359719d22b9454690cdb85dd7199ac5` belongs to release `updater-admin-e2e-332273d`, has no source-map processing errors, and is symbolicated to `src/lib/api/client.ts` lines 399 and 383. The deprecated CLI diagnostic independently reports that the exception is already source mapped; its subsequent legacy release-file warning does not understand modern artifact bundles and is not the association authority.
- Current remaining gates are only the OSS upload-role/lifecycle/live-smoke verification and the human forced-password final submit.

## Live OSS and Browser Superseding Evidence - 2026-07-20

The blocked live-OSS and forced-password bullets above are retained as history and superseded by this authorized result.

- Role proof: STS assume-role succeeded, and the temporary session completed multipart initiation, one-part upload, and application-issued abort with only prefix-scoped `oss:PutObject` and `oss:AbortMultipartUpload`. Neither runtime identity has completed-object deletion authority.
- Browser upload proof: the Codex in-app browser obtained credentials with HTTP 200 and sent real cross-origin multipart requests to `updater-files.oss-cn-shanghai.aliyuncs.com`; OSS returned HTTP 200 and stored a 303-byte object under `updater-admin-e2e/`.
- Packaging defect proof: the failing Function ZIP had `node_modules/ali-oss/package.json` but no `lib/client.js`, exactly reproducing `MODULE_NOT_FOUND` and the sanitized completion 503. Static server import made Vite/NFT trace the SDK; the rebuilt ZIP contains `lib/client.js`, and the targeted metadata/STS test file passes 14/14.
- Recovery and creation proof: on nonproduction deploy `6a5d91653c4efdfb5a6ee569`, browser retry observed `/api/v1/uploads/complete` HTTP 200, the UI marked the file registered, and `POST /api/v1/programs/{programId}/versions` returned 201.
- Persistence proof: Neon joins version `ab3dd5da-79df-41d8-b9f3-f9d9b10f27f5` to file `618c138c-48c0-4064-985f-50feeeaa654a`, path `.codex-e2e-upload/payload.txt`, size 303, nonempty ETag, and canonical key `updater-admin-e2e/b7a95a32a5101e570366196fdecdb36e663f02d9f8ae20ecc2ef9b31e774f0ac/.codex-e2e-upload/payload.txt`.
- Activation proof: after replacing the obscurable hidden-input control with a native accessible switch button, final deploy `6a5d95ea2c8afd55c56dc095` returned HTTP 200 for the real browser activation request; the UI showed `1.0.0` checked, active, and latest. Focused tests passed 17/17, TypeScript passed, the production build uploaded source maps, and post-build `dist` contained zero map files.
- Residual environment evidence: upload CORS is operational but does not expose `ETag`, so the first browser completion reports the specific CORS error before server-HEAD recovery succeeds. Add `ETag` to exposed headers. Read-only lifecycle and CORS queries returned 403 for the application principal; this is correct least privilege, but an environment operator still must verify the bucket-level incomplete-multipart lifecycle rule.
- Production was never published, and the completed E2E object was intentionally not deleted.

## Public Release API Preview and Production Readiness Evidence - 2026-07-20

- Implementation evidence: the separate anonymous `/api/public/v1` module, repository, domain, CORS/rate-limit plugin, shared manifest DTO, and individual OSS GET signer are present. The contract permits at most 256 files per version and bounds signing concurrency at eight without reordering files.
- Defect/remediation evidence: the initial Preview query failed at the outer join because selected columns from the derived release query were referenced through the wrong SQL aliases. The repository now addresses the explicit selected-release aliases; Preview verification passed after rebuilding with that correction.
- Deployment evidence: the authoritative corrected ready Preview deploy is `6a5daddfadd194231b14ea70`. This was a nonproduction verification deploy. Source maps were not uploaded for it, and no current-build Sentry source-map association is claimed.
- Formal-site evidence: Netlify Site ID `180cc440-4b2f-4313-867d-d33146376287` and canonical domain `https://updater-admin-019f5bdd32ab7261.netlify.app` exist. No production deploy has been published to that Site.
- Cleanup evidence: `docs/aegis/plans/2026-07-20-production-e2e-cleanup-manifest.md` records the exact program, version, file, relation, temporary user, account, one metadata row, 18 audit IDs, and one optional exact rate-window key. It requires a serializable, exact-cardinality transaction and forbids broadening after rate-window expiry. No deletion was performed by this documentation update.
- Open production gates: the Netlify plan currently prevents required deploy-context secret scoping; exact E2E cleanup and the intended production administrator bootstrap require explicit confirmation; and the current candidate's source maps require fresh informed upload approval. Historical source-map approval is not carried forward implicitly.

### Production-preflight update

- The operator subsequently confirmed the exact cleanup manifest, production administrator identity, and production source-map upload.
- A fresh read-only Neon transaction matched the one program, one version, one file, one relation, banned temporary administrator, credential account, metadata row, and all 18 explicit audit IDs. No sessions, verification rows, extra actor/resource audit rows, or non-target logical actor references existed; the optional rate window had expired.
- The `system_settings` and Drizzle migration fingerprints were recorded and matched the expected one settings row and two migration rows. No write, cleanup, administrator creation, migration, or OSS operation was performed.
- Independent maintenance review requires an operator-known bootstrap password through a non-logging channel before cleanup, so an administrator credential cannot be lost or disclosed in cleanup output. The operator must add `BOOTSTRAP_ADMIN_PASSWORD` to ignored `.env.local` before the exact transaction and bootstrap proceed.

## Formal Production Deployment and Public API Evidence - 2026-08-06

- Secrets Controller evidence: the formal Free-plan Site reports secret support and no granular scope-selection entitlement. A temporary `is_secret: true` value returned HTTP 201, was masked on read, and deleted with HTTP 204. Nineteen Production-context variables were configured; five credentials are masked write-only secrets with build/Functions/runtime scope, and no bootstrap/test/Netlify credential was uploaded.
- Cleanup evidence: read-only preflight returned `matched` with 18 audits, one settings row, two migration rows, and the optional rate row absent. Execute returned `committed-and-verified` with exact counts: account 1, administrator metadata 1, application 1, audits 18, file 1, rate window 0, user 1, version 1, and version-file relation 1. Post-commit target reads were empty and preservation fingerprints matched.
- Bootstrap evidence: Better Auth returned `Initial administrator created.` Secret-free verification found exactly one production user, one credential account, one administrator metadata row, zero sessions, role `admin`, and `mustChangePassword=false`.
- Verification evidence: `pnpm exec tsc --noEmit`, Biome over 299 files, 108 Vitest files/641 tests, route generation, Drizzle schema check, migration preparation, production build, and `git diff --check` exited 0. The two migrations were already current. Post-build inspection found 201 deploy files, zero source maps, and both the Netlify function entry and server bundle.
- Sentry evidence: production release `332273de028fc8faca34e9058cee0d55bc0b33fc` uploaded artifact bundle `646a6712-fff7-5856-a9bb-a12247086e52` to the configured project. A subsequent authenticated read returned HTTP 200 and associated the exact release with project `updater-admin`. Source maps were removed only after all Vite environments completed and are absent from the deploy artifact.
- Netlify evidence: official CLI `27.1.0` published production deploy `6a73ec801b96527dc4878d85` to `https://updater-admin-019f5bdd32ab7261.netlify.app` using explicit `dist/client` and `.netlify/v1/functions` paths from the confirmed worktree.
- HTTP evidence: `/health` returned 200 JSON; anonymous `/api/v1/programs` returned 401 Problem Details; a missing public release returned 404 Problem Details; an allowed Production-origin preflight returned 204 with the exact allow-origin value; an unlisted origin returned 403.
- Positive public API evidence: a fixed-ID, active `9.9.9` release temporarily referenced the preserved OSS smoke object. With no Cookie or Authorization header, both latest and specified-version endpoints returned 200, exposed no object key/ETag/internal IDs, and issued an HTTPS signed URL. The URL downloaded 303 bytes from `updater-files.oss-cn-shanghai.aliyuncs.com`; computed SHA-256 matched the manifest. Exact guarded cleanup then removed all four metadata rows, left the object intact, restored program/version/file/relation totals to zero, preserved one production user, and made the temporary public URL return 404.
- Actual browser evidence: the Codex in-app browser followed the protected `/programs` redirect, logged in as the production administrator, rendered the empty TanStack Table, opened the administrator page, preserved Program/Administrator dynamic tabs, showed Neon and OSS readiness as normal, changed the monitoring range to 7 days, rendered zero-event audit and system settings, opened both language and account menus, logged out, and reported no console warnings/errors.
- Final state evidence: the Netlify API reports production deploy `6a73ec801b96527dc4878d85` in `ready` state; `/health` remains `{"status":"ok"}`; production holds zero programs, versions, files, relations, and sessions plus exactly one administrator user.
- Credential follow-up: the browser accessibility snapshot returned the filled password input value in this task's tool log. The value is not present in tracked files or Netlify bootstrap variables, but the operator must rotate the production administrator password and remove the bootstrap value from ignored local configuration. Browser safety rules prohibit the agent from choosing and submitting that replacement password without operator action.
