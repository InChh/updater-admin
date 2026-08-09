# Backend Quality and Operations

> Required verification, migration, deployment, and observability contracts.

## Scenario: Verify or Release a Server Change

### 1. Scope / Trigger

Use this contract for backend code, shared API contracts, migrations, auth,
database behavior, provider integrations, Netlify deployment, Sentry, security
headers, health/readiness, or release-gate claims.

### 2. Signatures and Commands

Use repository scripts rather than ad hoc equivalents:

```bash
pnpm check
pnpm typecheck
pnpm test
pnpm test:db
pnpm db:check
pnpm build
pnpm deploy:prepare
pnpm bootstrap:admin
```

- `pnpm test` uses `vitest.config.ts`, jsdom, and excludes `*.db.test.ts` and
  Playwright.
- `pnpm test:db` uses `vitest.db.config.ts`, Node, one worker, serial files, and
  `src/test/db-global-setup.ts`.
- `pnpm deploy:prepare` runs Drizzle migrations explicitly; application request
  startup never migrates.

### 3. Contracts

#### Local quality

- Biome 2.4.5 and strict no-emit TypeScript are required.
- Unit/module/domain/repository tests must inject dependencies and must not
  require live database, OSS, auth, or Sentry configuration unless they belong
  to an explicitly environment-gated suite.
- Elysia schemas and shared DTOs stay compile-time aligned.
- Migration-bearing changes include generated Drizzle SQL/meta, schema tests,
  `pnpm db:check`, and disposable database verification.

#### Destructive database safety

- `TEST_DATABASE_URL` must point to a disposable database and must not identify
  the same database as `DATABASE_URL`.
- `TEST_DATABASE_CONFIRM_DISPOSABLE` must equal exactly
  `updater-admin-destructive-tests`.
- `src/test/db-global-setup.ts` applies migrations and truncates only after
  `assertDisposableDatabaseGuard` succeeds.

#### Deployment and observability

- Netlify builds with `pnpm build`; server routes run as functions and artifact
  bytes remain in OSS.
- Runtime/database migrations happen before publication, not lazily on request.
- Sentry client/server source-map upload is an external gate. DNS failure or a
  successful app build without upload is not Sentry acceptance.
- TanStack Start invokes multiple Vite build environments. Do not configure
  Sentry's per-environment `filesToDeleteAfterUpload`: an early phase can
  delete maps before the final bundle uploads. `package.json` instead runs
  `scripts/remove-source-maps.mjs` only after the top-level `vite build`
  succeeds; build cleanup must leave no public source maps.
- Sentry reporting and the API plugin's failed-mutation audit are best effort:
  their failures never replace the original mapped API response. Successful
  mutation audits are different; where a repository owns them transactionally,
  an append failure rolls back the mutation rather than reporting false success.
- Monitoring exposes application/Neon/OSS readiness, live business metrics,
  release trends, and audit activity. It does not fetch or mirror Sentry Issue
  data; `src/server/domain/monitoring.server.ts`,
  `src/server/db/repositories/monitoring.server.ts`, and
  `src/features/monitoring/monitoring-overview-page.tsx` are the current owners.
  Neon, OSS STS, metrics, and recent-operation probes degrade independently,
  run concurrently, and use separate bounded cache/single-flight operations;
  the production defaults are a 30-second result cache and a five-second
  operation timeout. `/health` remains a minimal unauthenticated
  `{ status: "ok" }` liveness response and never performs those readiness
  probes. Preserve the timeout, coalescing, late-settlement, and independent
  degradation coverage in `src/server/domain/monitoring.test.ts`.
- Static and dynamic responses preserve the security header contract from
  `netlify.toml`, `src/start.ts`, and `src/server/security/headers.ts`.
- Browser Sentry is client-only, while
  `src/server/integrations/sentry/sentry.server.ts` performs a bounded
  2,000 ms flush so Netlify cannot freeze queued events immediately after the
  response. Reporter failure still remains best effort.
- Keep `zod` 4.x as a direct production dependency; Better Auth's generated
  Netlify server can leave that import external. Preserve the namespace import
  and `.meta` assertion in `src/server/auth/zod-runtime.test.ts`, plus the
  manifest guard in `src/test/runtime-dependencies.test.ts`. Also keep
  `@opentelemetry/semantic-conventions` in Vite `ssr.noExternal` so NFT does
  not depend on a pnpm symlink surviving Function packaging.

### 4. Validation & Error Matrix

| Gate/condition | Required interpretation |
|----------------|-------------------------|
| `pnpm check` or `pnpm typecheck` fails | task is not locally valid |
| Unit test fails because a supposedly skipped file throws during import | real test-harness failure; do not call the suite skipped or passed |
| Disposable DB variables absent | DB suite is explicitly skipped/gated, not passed |
| DB URL equals production/shared URL or sentinel differs | abort before migration/truncation |
| Build exits 0 but Sentry upload fails | build passed; Sentry gate failed/unverified |
| Mocked OSS/Netlify/Sentry test passes | local contract evidence only |
| Real provider/browser gate is not configured | report unverified and preserve the release gate |
| Reporter throws while mapping an API error | keep original sanitized API response |

Current baseline note: `src/features/versions/large-upload.acceptance.test.ts`
imports `scripts/accept-large-release.ts` before its conditional suite can skip;
without `DATABASE_URL`, standard `pnpm test` currently fails at module import.
Treat this as a test-harness defect to fix in its own scope, not as a passing or
accepted environment gate.

### 5. Good / Base / Bad Cases

- Good: a migration change passes static checks, schema checks, unit tests, the
  explicitly authorized disposable DB suite, production build, then the
  configured nonproduction provider/browser gates.
- Base: a documentation-only change passes content checks, Biome, and
  TypeScript; unrelated baseline failures are reported with exact evidence.
- Bad: set test variables to production, run migrations at request startup,
  claim Sentry from a DNS-failed build, or equate Playwright/mocks with manual
  in-app-browser/provider acceptance.

### 6. Tests Required

- API/module/domain/repository changes: closest unit tests plus `pnpm test`.
- Schema/transaction changes: closest `*.db.test.ts` under the exact disposable
  guard plus `pnpm db:check`.
- Auth/security changes: auth, plugin, redaction, header, and Sentry unit tests.
- Public API changes: v1/v2 compatibility, CORS, rate-limit, visibility,
  signing, and live nonproduction HTTP probes as applicable.
- Upload changes: mocked workflow tests plus real sandbox OSS STS, CORS,
  multipart, no-overwrite, reconciliation, and cleanup evidence when release
  acceptance is requested.
- Deployment changes: production build, source-map absence, function `/health`,
  protected/public route probes, and real in-app-browser acceptance.

### 7. Wrong vs Correct

#### Wrong

```text
Build passed, therefore Sentry and Netlify are accepted.
DB tests skipped, therefore database behavior passed.
```

#### Correct

```text
Build: passed.
Sentry upload: failed or unverified, with exact output.
Disposable DB suite: skipped because guarded variables were absent.
Provider/browser acceptance: separately verified or explicitly outstanding.
```

Keep local, mocked, skipped, and environment-backed evidence distinct in every
review and release report.
