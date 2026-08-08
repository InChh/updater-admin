# Public Release API and Production Deployment Plan

## Aegis Visibility

This change adds a new anonymous public contract and a production publication boundary. Planning keeps the public read surface separate from the administrator API, prevents credential or object-key leakage, and stops irreversible database cleanup until exact E2E rows are enumerated.

## Plan Basis

- Requirement authority: user confirmation on 2026-07-20.
- Approved behavior: anonymous read-only public release APIs; explicit browser-origin allowlist; formal Netlify production Site/domain; existing Neon database is production and only confirmed test rows may be removed.
- Parent architecture: `docs/aegis/adr/ADR-0001-same-origin-start-elysia-boundary.md` and `docs/aegis/baseline/2026-07-14-initial-baseline.md`.
- Scope change: the earlier exclusion of anonymous updater APIs is superseded only for this redesigned public namespace. No legacy UpdaterServer paths, DTOs, download STS, or compatibility behavior is restored.

## Requirement Ready Check

- Goals: expose release discovery and download links without exposing administrator operations.
- Scenario: an unauthenticated native, server, or allowlisted browser consumer fetches the latest or a specified active release.
- Acceptance: inactive/deleted data is invisible; responses contain no credentials, raw object-key field, OSS ETag, actor data, mutation ETag, or administrator-only metadata; signed URLs expire; non-allowlisted browser origins fail closed; admin routes remain session-protected.
- Implementation status: complete and verified on Preview and formal production after correcting the selected-release SQL derived-table alias binding.
- Formal production target: Netlify Site ID `180cc440-4b2f-4313-867d-d33146376287`, canonical domain `https://updater-admin-019f5bdd32ab7261.netlify.app`, production deploy `6a73ec801b96527dc4878d85`.
- Publication gates: closed. The Site's Free plan supports masked Secrets Controller values; the confirmed cleanup, production bootstrap, source-map upload, deployment, HTTP contract checks, positive public release/download smoke, and in-app-browser acceptance all passed.
- Decision: production published and verified on 2026-08-06.

## Public Contract

### Endpoints

- `GET /api/public/v1/programs/:programId/releases/latest`
- `GET /api/public/v1/programs/:programId/releases/:versionNumber`

Both return one manifest:

```json
{
  "programId": "uuid",
  "programName": "string",
  "versionNumber": "1.2.3",
  "description": "string",
  "publishedAt": "RFC3339 timestamp",
  "downloadExpiresAt": "RFC3339 timestamp",
  "files": [
    {
      "path": "relative/path.bin",
      "size": "123",
      "sha256": "64 lowercase hex characters",
      "checksumAlgorithm": "sha256",
      "mimeType": "application/octet-stream",
      "downloadUrl": "short-lived HTTPS OSS signed URL"
    }
  ]
}
```

- `latest` selects the highest numeric semantic version among live active rows.
- A specified version is returned only when its program and version are live and the version is active.
- Files are live, version-scoped, and ordered by path then internal ID.
- A release is bounded to 256 files. The server rejects a violated persistence invariant, and individual signed URLs are generated with at most eight signer operations in flight while preserving file order.
- Signed GET URLs expire after 300 seconds. Responses use `Cache-Control: no-store` so expired URLs are not cached as manifests.
- Missing or inactive resources use the existing sanitized Problem Details `404 NOT_FOUND` response.

### Security and CORS

- Existing `/api/v1/*` administrator routes retain Better Auth session, admin-role, ban, forced-password, origin, audit, and mutation controls unchanged.
- No upload credentials, upload completion, global file list, administrator, profile, settings, monitoring, audit, or mutation route becomes anonymous.
- `PUBLIC_API_ALLOWED_ORIGINS` is a comma-separated list of canonical HTTPS origins, with localhost HTTP allowed only outside production.
- Requests without `Origin` remain valid for native/server consumers. Browser requests with an unlisted origin receive 403. Preflight permits only `GET`, `HEAD`, and `OPTIONS`, has no credentials, and varies by `Origin`.
- Public GET/HEAD requests use the existing Neon fixed-window limiter at 120 requests per client IP per minute. Netlify's validated client-connection IP header remains the primary source.

## Change Necessity and Ownership

- Code change was required because all prior business routes were administrator-session routes. The separate public release contract is now implemented without weakening those routes.
- Elysia remains the canonical API owner; TanStack Start remains the raw request transport; Drizzle/Neon remains persistence owner; the permanent OSS server principal signs individual GET URLs without issuing download STS.
- Add a separate public repository/domain/module/plugin surface rather than weakening the existing session plugin or reusing administrator DTOs.

## TDD Route

- Mode: off
- Decision: skipped
- Strict authority: not applicable
- Test posture: post-change contract, repository, integration, CORS, limiter, and signer regression tests
- Reason: the user did not request strict TDD; proportional verification is required for the new public/security boundary.
- Verification: focused Vitest, guarded database test when safe, Biome, TypeScript, full Vitest, Netlify build/package inspection, and real production HTTP/browser checks.

## Files

- Add `src/shared/api/public-releases.ts` for the public wire contract.
- Add `src/server/db/repositories/public-releases.server.ts` for one bounded joined query.
- Add `src/server/domain/public-releases.server.ts` for manifest mapping and signed-link orchestration.
- Add `src/server/integrations/oss/download-url.server.ts` for single-object signed GET URLs.
- Add `src/server/api/modules/public-releases.ts` and `src/server/api/plugins/public-api.server.ts` for routing, CORS, and IP limiting.
- Update `src/server/api/app.server.ts`, `src/server/env.server.ts`, OSS typings, and focused tests.
- Amend `AGENTS.md`, README/environment guidance, baseline/ADR, checkpoint/evidence, and Aegis index.

## Execution Tasks

1. Implement strict origin-list parsing and public API dependencies with injectable clocks, signer, repository, and limiter.
2. Implement latest/specified active-release queries and server-only object-key handling.
3. Implement 300-second per-object OSS signed URLs and sanitized manifest mapping.
4. Mount the public module outside the administrator session group; add public-only CORS/preflight and IP rate limiting.
5. Add negative tests for inactive/deleted releases, unlisted origins, method/preflight limits, rate-limit failure, hidden fields, canonical semver, and signer failure sanitization.
6. Update durable architecture and deployment context, including the new required production origin allowlist.
7. Run the verification matrix and independent specification/code-quality review.
8. Read-only enumerate rows attributable to the known E2E program and temporary administrator. Present the exact deletion set and rollback note before deletion.
9. After the formal Site ID/domain and scoped deletion confirmation are available, configure production environment variables, migrate if required, build, deploy, and verify production UI plus both public endpoints. Do not publish the E2E branch artifact to the formal site.

Tasks 1–9 are complete. Corrected Preview deploy
`6a5daddfadd194231b14ea70` remains the SQL-alias-fix evidence. The confirmed
cleanup manifest executed with exact counts, production bootstrap passed, and
production deploy `6a73ec801b96527dc4878d85` published release
`332273de028fc8faca34e9058cee0d55bc0b33fc` after Sentry uploaded artifact bundle
`646a6712-fff7-5856-a9bb-a12247086e52`.

## Data Destruction Guard

- Target class: persistent-state rows in the production Neon database.
- Allowed target: only rows proven to belong to the known Codex E2E program/version/file relation, temporary administrator/session/account metadata, and their attributable test audit/rate-limit records.
- Not authorized: other users, programs, versions, files, audit history, settings, OSS objects, schemas, tables, or migrations.
- Status: the confirmed exact manifest executed on 2026-08-06. All fixed targets are absent, the optional rate-window row was already absent, preservation fingerprints match, and the OSS object remains.

## Verification and Stop Conditions

- Contract/module/domain/repository tests pass, including negative security assertions.
- Existing administrator authorization tests remain green.
- `pnpm check`, `pnpm typecheck`, full `pnpm test`, guarded DB checks appropriate to the production-data boundary, `pnpm build`, source-map cleanup, function packaging, and `git diff --check` pass.
- Production environment has canonical `BETTER_AUTH_URL`, `PUBLIC_API_ALLOWED_ORIGINS`, production Sentry release/environment, OSS/Neon variables, and the formal Netlify Site ID. Five credentials are masked Secrets Controller values in the Production context; bootstrap/test/Netlify credentials are not deployed.
- Production checks: `/health` 200; anonymous admin API 401; unlisted-origin public API 403; listed-origin latest and specified release 200; login and program-management page render; console has no errors.
- Release result: every listed publication stop condition was cleared before deploy. Later releases must reapply the same stop conditions rather than treating this one release's approval or evidence as permanent authority.
