# Proof Bundle - 2026-07-14-updater-admin-implementation

## Method Pack Boundary

This proof bundle is an advisory Aegis Method Pack record. It does not determine evidence sufficiency, produce authoritative `GateDecision`, or grant `completion authority`.

## Task Intent

- Requested outcome: Implement the approved Updater Admin plan in verified vertical batches
- Scope: Execute docs/aegis/plans/2026-07-14-updater-admin-implementation.md batches 0-14

## Impact

- Compatibility boundary: New /api/v1 administration contract only; legacy UpdaterServer wire contracts and data are excluded
- Non-goals:
- Provision or mutate production cloud resources
- Modify UpdaterServer or existing updater clients
- Add Billing, tenancy, or legacy compatibility

## Evidence Bundle Refs

- docs/aegis/work/2026-07-14-updater-admin-implementation/evidence-bundle-draft-batch0-baseline.json
- docs/aegis/work/2026-07-14-updater-admin-implementation/evidence-bundle-draft-batch0-worktree.json
- docs/aegis/work/2026-07-14-updater-admin-implementation/evidence-bundle-draft-batch1-tooling.json
- docs/aegis/work/2026-07-14-updater-admin-implementation/evidence-bundle-draft-batch10-14-release.json
- docs/aegis/work/2026-07-14-updater-admin-implementation/evidence-bundle-draft-batch2-database.json
- docs/aegis/work/2026-07-14-updater-admin-implementation/evidence-bundle-draft-batch3-auth.json
- docs/aegis/work/2026-07-14-updater-admin-implementation/evidence-bundle-draft-batch4-api.json
- docs/aegis/work/2026-07-14-updater-admin-implementation/evidence-bundle-draft-batch6-programs.json
- docs/aegis/work/2026-07-14-updater-admin-implementation/evidence-bundle-draft-batch7-versions.json
- docs/aegis/work/2026-07-14-updater-admin-implementation/evidence-bundle-draft-batch8-uploads.json
- docs/aegis/work/2026-07-14-updater-admin-implementation/evidence-bundle-draft-batch9-versions-ui.json
- docs/aegis/work/2026-07-14-updater-admin-implementation/evidence-bundle-draft-external-preview-e2e-2026-07-19.json

## Drift Check

- Scope status: Batches 10-14 stayed within the approved administrator/profile/account, system-settings, monitoring/audit, Sentry/Netlify/security, scaffold-retirement, and release-evidence scope.
- Compatibility status: No Dashboard, Billing, tenancy, legacy updater-client/API compatibility, legacy-data import, download STS, Sentry Issue ingestion, automatic OSS deletion, or duplicate identity/cache/API owner was added.
- Retirement status: Scaffold demos and routes were retired only after production owners and tests existed for the requested TanStack libraries; the initial baseline remains an append-only historical snapshot.
- Advisory decision: needs-verification

## External Preview and Browser Proof - 2026-07-19

This section supersedes the earlier database-safety pause for current external-gate status while preserving it as historical evidence.

- Database: the user expressly authorized destructive repair; reset, migration, and bootstrap passed. An initial guarded rerun was partial at 5/6 files and 23/25 tests, but bounded 30-second test/hook timeout remediation superseded it: the version file passed 6/6 three consecutive times, the full suite passed 6/6 files and 25/25 tests, and all 13 approved tables were empty afterward. Migrations and a one-time nonproduction bootstrap administrator were then restored without persisting or disclosing its credential.
- Netlify: latest deploy `6a5d7460187ccd05113f28e7`, titled `sentry-sourcemap-upload-verified`, is ready only on alias `codex-e2e-332273d` for project `updater-admin-e2e-019f5bdd32ab7261`; production was never published. The Codex in-app browser reverified the rendered login redirect with zero console events, JSON health, and anonymous Problem Details 401.
- Public contracts: `/health` returned 200 with the five expected security headers, `/` redirected to programs, and anonymous `/api/v1/programs` returned the expected 401 Problem Details response.
- Concurrency: because Netlify strips standard request `If-Match`, mutations use `X-Updater-If-Match` while responses retain standard `ETag`; direct authenticated and real UI mutations passed, and standard `If-Match` alone remained a 428.
- Browser acceptance: the main program, nested-route/dynamic-tab, monitoring, audit, localization, settings, and administrator-disable flows passed in the Codex in-app browser. The final stable-key tab-retitle deploy preserved the exact query and title across hard reload in a fresh tab with zero console errors; test data and tabs were cleaned up.
- Local verification: focused tests, TypeScript, Biome, and build pass. After replacing the Zod convenience-alias import with the direct module namespace while retaining the same runtime assertion, and inlining `@tanstack/solid-start` in the test-only transform pipeline, literal `pnpm test` under standard Node 22 passes 101/101 files and 589/589 tests. The full direct-Bun suite independently passes the same 101/101 files and 589/589 tests.
- Sentry: the authorized repaired build uploaded complete artifact bundle `4d712dfc-e2e0-54a6-a122-d8564eedba27`; event `3359719d22b9454690cdb85dd7199ac5` on release `updater-admin-e2e-332273d` has no processing errors and resolves the deployed API-client stack to `src/lib/api/client.ts` lines 399 and 383. Post-upload cleanup leaves no public `.map` asset.
- Remaining advisory gates: OSS upload-role/lifecycle/live-smoke verification and a human-performed forced-password final submit. The permanent application principal remains limited to `sts:AssumeRole` plus prefix-scoped `oss:GetObject`; incomplete multipart cleanup belongs to lifecycle, and any completed-object sandbox cleanup requires a separate explicitly authorized test identity. The temporary administrator is disabled.
- Current advisory decision: external-preview-and-sentry-passed-residual-security-gates-open

## Live OSS and Final Browser Proof - 2026-07-20

- Direct OSS proof passed for assume-role, multipart initiation, part upload, and application-issued abort under the temporary role's two-action prefix policy.
- The actual in-app browser uploaded the 303-byte fixture to OSS. A missing CORS-exposed `ETag` triggered the explicit degraded-state message, after which the supported server-HEAD recovery returned 200 without a second upload.
- A Netlify NFT omission of dynamically required `ali-oss` caused the initial completion 503. Static import fixed the trace; the rebuilt Function includes the SDK entry, and nonproduction deploy `6a5d91653c4efdfb5a6ee569` completed registration and version creation.
- Neon independently confirms the version/file relation, canonical object key, byte size, ETag, and active state. Final deploy `6a5d95ea2c8afd55c56dc095` also passed real-browser activation after the switch became a native accessible button.
- Production was never published and the completed object was not deleted. Bucket CORS must expose `ETag`, and an environment operator must verify the incomplete-multipart lifecycle rule with a separate operator identity; the runtime principals correctly cannot inspect bucket configuration.
- Current advisory decision: live-application-e2e-passed-bucket-configuration-follow-up-open

## Formal Production Proof - 2026-08-06

- Netlify Free-plan Secrets Controller support was verified by a reversible masked-secret probe; 19 Production-context variables were configured and five credentials are write-only.
- The exact production cleanup manifest executed with every expected count and unchanged settings/migration fingerprints. Better Auth then created the intended administrator separately.
- TypeScript, Biome, 108 Vitest files/641 tests, Drizzle check/migration preparation, production build, Sentry source-map upload, post-build source-map removal, and diff-check passed.
- Sentry release `332273de028fc8faca34e9058cee0d55bc0b33fc` and artifact bundle `646a6712-fff7-5856-a9bb-a12247086e52` are associated with project `updater-admin`.
- Netlify production deploy `6a73ec801b96527dc4878d85` is ready at `https://updater-admin-019f5bdd32ab7261.netlify.app`.
- Health, authorization, CORS, anonymous latest/specified release manifests, signed OSS download, byte count, SHA-256, exact fixture cleanup, authenticated in-app-browser pages, dynamic tabs, provider readiness, logout, and zero console errors passed.
- Final state is zero business rows, zero sessions, one production administrator, and a preserved OSS smoke object. Operator follow-ups are production-password rotation plus bucket-level `ETag` CORS exposure and incomplete-multipart lifecycle verification.
- Current advisory decision: formal-production-and-public-api-verified
