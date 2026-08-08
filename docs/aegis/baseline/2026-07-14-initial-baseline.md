# Updater Admin Initial Baseline

Date: 2026-07-14
Status: initial dual-baseline snapshot; design approval recorded 2026-07-14

## 1. Purpose

This snapshot records the scaffold state and the confirmed design inputs that later plans and implementation reviews must compare against. It remains historical evidence; the user subsequently approved the design spec on 2026-07-14.

## 2. Workspace Structure

- TanStack Start Solid application at the repository root.
- Generated routes and integration demonstrations under src/.
- Netlify deployment adapter in vite.config.ts and netlify.toml.
- Better Auth scaffold under src/lib and src/routes/api/auth.
- TanStack Query provider and Router context already generated.
- Durable project instructions in AGENTS.md.
- Pending Design Spec under docs/aegis/specs/.

## 3. Current Authority Surfaces

- User requirements and decisions in the active Codex task.
- AGENTS.md for scaffold provenance, hard gate, accepted decisions, environment requirements, and next steps.
- docs/aegis/specs/2026-07-14-updater-admin-design.md for the proposed full design.
- /Users/bytedance/prog/UpdaterServer at commit 277b28e for source business semantics and capability inventory, not HTTP compatibility contracts.
- Supplied screenshots for the program/version layout, dialogs, language menu, account menu, and visual direction.
- Package-shipped TanStack Intent guidance for Start, Router, deployment, data loading, auth guards, and server routes.

Authority update: the user explicitly approved the Design Spec on 2026-07-14. The indexed implementation plan now governs execution order and verification.

## 4. Product / Requirement Baseline

### 4.1 Current Truth

- Target state: a single-tenant version-management administration system with no Dashboard page.
- Users: authenticated administrators with identical full permissions.
- Core scenarios: manage programs, create/upload/manage versions, manage administrators, monitor system state, and review audit history.
- Backend requirement: migrate the administration-facing program/version/file/STS business capabilities to a redesigned Elysia `/api/v1/*` API while excluding legacy client compatibility and ABP/OpenIddict platform APIs.
- Data requirement: start with an empty Neon database and do not import legacy business data.
- Storage requirement: browser-to-Aliyun OSS direct upload with STS; Netlify does not proxy release files.
- Delivery requirement: one pnpm/Biome repository deployed to Netlify.
- Visual requirement: high-fidelity green administration UI based on supplied screenshots, responsive, Chinese by default with English support.
- Navigation requirement: login and `/` lead to `/programs`; a stateful dynamic tab bar sits below the top toolbar and above the page title.
- Verification expectation: formatting, typecheck, tests, build, contract tests, integration tests, E2E, and Netlify Preview smoke tests.

### 4.2 Non-negotiables

1. No business implementation before explicit Design Spec approval; this gate was satisfied on 2026-07-14.
2. No Billing feature.
3. No multi-tenancy.
4. No public registration.
5. All authenticated administrators have equal permissions.
6. Multiple versions can be active; latest is the highest active numeric major.minor.patch.
7. No automatic OSS object deletion.
8. Existing client migration and cutover are outside this project.
9. No Dashboard page; program management is the authenticated entry page.
10. Dynamic tabs retain opened pages across navigation and are not derived only from the current route.

### 4.3 Product Non-goals

- Billing, subscriptions, invoices, pricing, or payment integrations.
- Organization, workspace, or tenant isolation.
- Legacy business-data migration.
- Existing updater-client work.
- UpdaterServer route, DTO, error-code, or anonymous-client compatibility.
- Sentry Issue ingestion.
- Email invitation delivery.

## 5. Architecture / Runtime Boundary Baseline

### 5.1 Current Truth

- TanStack Router owns URL navigation and typed search state.
- TanStack Query is the only remote-cache owner.
- TanStack Table owns table projection/state but not server data.
- TanStack Form owns client form state; Elysia repeats all validation.
- TanStack Store owns only cross-component client UI state, including the persisted opened-tab history.
- TanStack Start owns SSR and Netlify transport entry.
- Better Auth owns /api/auth/* and Session lifecycle.
- Elysia is the canonical business API and authorization owner.
- Drizzle owns persistence access to fresh Neon Postgres.
- Browser uploads release files directly to OSS with short-lived STS credentials.
- Sentry owns error capture; internal monitoring owns health and business metrics.

### 5.2 Architecture Non-negotiables

1. Start route adapters contain no business rules or direct database mutations.
2. Router guards never substitute for Elysia API authorization.
3. Secrets and database access remain server-only.
4. `/api/v1/*` is a new administration API contract; no UpdaterServer path, DTO, `App:*` code, or client authentication compatibility is required.
5. Netlify Functions never receive release-file bodies.
6. Database migrations run explicitly, not during request startup.
7. No duplicate cache, auth, or API owners.

### 5.3 Architecture Non-goals

- Reimplementing ABP/OpenIddict platform services.
- A second Elysia deployment or separate backend repository.
- Direct database access from components or route loaders.
- Persistent client-state copies of server entities.
- Automatic OSS cleanup.

## 6. Ownership / Contract Snapshot

| Surface | Canonical owner |
|---|---|
| Page navigation and modal URL state | TanStack Router |
| Server data cache | TanStack Query |
| Table state | TanStack Table |
| Form state | TanStack Form |
| Sidebar, tabs, locale fallback, upload queue | TanStack Store |
| SSR and Netlify request transport | TanStack Start |
| Login and Session | Better Auth |
| Business contracts and authorization | Elysia |
| SQL and schema | Drizzle + Neon |
| Release binaries | Aliyun OSS |
| Error telemetry | Sentry |
| Audit and business monitoring | Elysia + Neon |

## 7. Current State and Risks

- Scaffold builds, typechecks, and passes Biome; no business tests exist yet.
- Better Auth is not yet connected to Neon.
- Elysia, Drizzle, Table, and Neon packages are present but not wired.
- Netlify/Elysia same-function integration must be proven with an implementation spike and Preview smoke test.
- New Elysia request, response, pagination, Problem Details, and concurrency contracts require direct Contract Tests.
- Upload STS must use least-privilege short-lived credentials; download STS for legacy clients is out of scope.
- Intent reports two transitive devtools-event-client versions; the current scaffold still builds.

## 8. Alignment Use

- Read the Product / Requirement Baseline before changing routes, user flows, roles, tenancy, Billing scope, upload behavior, or acceptance criteria.
- Read the Architecture / Runtime Boundary Baseline before changing owners, adding adapters, changing API paths, accessing secrets, or introducing new state.
- Report scope: both for work that changes API behavior, persistence semantics, auth, upload, monitoring, or deployment.

## 9. Source-System Boundary

- Use the 23 repository-owned endpoints only to inventory source business capabilities and edge cases.
- Do not preserve UpdaterServer paths, DTOs, ABP envelopes, anonymous markers, or App:* error codes.
- Preserve only explicitly accepted domain rules, such as multiple active versions and highest-active numeric latest selection.
- Do not copy known implementation defects such as invalid numeric parsing, remove-only file-update failure, missing database uniqueness, EF shadow relationships, or timezone-less timestamps.
- Do not infer authority to modify the legacy UpdaterServer, production data, OSS objects, Netlify site, Neon project, or updater clients.

## 10. Implementation Status Update - 2026-07-15

This section appends the completion-candidate state without rewriting the historical scaffold snapshot above.

### 10.1 Implemented State

- Plan Batches 0-14 have implementation owners in the isolated `codex/updater-admin-implementation` worktree.
- The authenticated entry remains program management; no Dashboard, Billing, tenant, legacy `/api/app/*`, `/about`, or scaffold `/demo/*` production route remains.
- Better Auth owns identity, password, ban, and session lifecycle; Elysia owns the redesigned `/api/v1` business API and authorization; Drizzle/Neon own persistence.
- TanStack Start and Router own SSR, transport, routes, guards, nested pages, and dynamic tabs; Query owns remote cache; Table owns list projection; Form owns forms; Store owns only cross-component shell/upload state; CLI and Intent remain represented by project scripts/metadata and durable guidance.
- Programs, versions, direct-to-OSS uploads, administrators/profile/account, optimistic system settings, authenticated monitoring/audit, native SVG release trends, Sentry, and Netlify security/deployment structure are implemented.
- Scaffold demonstrations were retired only after their requested library integrations had production owners and verification paths.

### 10.2 Proven Evidence Boundary

- The Batch 13 checkpoint proved 95 test files and 542 tests plus its static, type, build, diff, Netlify-function, and security-header checks. Those values remain Batch 13 historical evidence, not final release totals.
- The current Batch 14 browser evidence is 8 public desktop/mobile tests passed and 18 authenticated tests explicitly skipped because seeded E2E credentials were unavailable. Credential-gated workflows and screenshot artifacts are not treated as passed.
- The authoritative final local matrix passed on 2026-07-15: frozen install, route generation, Intent 10 packages/31 skills, TanStack CLI 16-library discovery, Biome over 279 files, TypeScript, 98 Vitest files/568 tests, Drizzle schema check, Netlify client/SSR build, built-function health/security-header smoke, route/client-secret/source-map scans, and diff-check.

### 10.3 Remaining External Gates

- Disposable-database execution requires approved `TEST_DATABASE_URL` and the destructive-test confirmation sentinel.
- Authenticated E2E and 1920px/390px visual evidence require seeded `E2E_ADMIN_EMAIL` and `E2E_ADMIN_PASSWORD`.
- Live OSS STS/multipart, live Sentry event/source-map, and authorized Netlify Preview checks require separately approved external environments and credentials.
- Production migration, bootstrap-secret removal, cloud configuration, deploy, and Preview verification remain explicit follow-up actions; this documentation update authorizes none of them.
- The rationale for the same-origin TanStack Start/raw Request/Elysia boundary is recorded in `docs/aegis/adr/ADR-0001-same-origin-start-elysia-boundary.md`; this baseline remains the current-state owner map.

Status: local implementation and verification complete; disposable database, authenticated visual/E2E, live OSS, live Sentry, and authorized Netlify Preview evidence remain external. Method Pack records are advisory and do not grant deployment authority.

### 10.4 External-evidence Superseding Update - 2026-07-20

The 10.3 gate list above is the 2026-07-15 completion-candidate state and is superseded for current status by the following authorized evidence:

- The user-authorized database reset/migration/bootstrap, guarded database suite, nonproduction Netlify Preview, authenticated administration flows, and actual Codex in-app-browser acceptance have passed as recorded in the checkpoint and external evidence bundle.
- After explicit source-disclosure approval, complete Sentry artifact bundle `4d712dfc-e2e0-54a6-a122-d8564eedba27` was uploaded. Deployed browser event `3359719d22b9454690cdb85dd7199ac5` has no processing errors and resolves to `src/lib/api/client.ts` lines 399 and 383. Hidden maps are removed after all Vite phases and are not public deployment assets.
- Latest nonproduction Netlify deploy `6a5d7460187ccd05113f28e7` is ready only on alias `codex-e2e-332273d`; production was never published.
- Current external gates are limited to live OSS upload/lifecycle proof and a human forced-password final submit if end-to-end credential-rotation evidence is required.

Status: nonproduction Preview, actual browser, database, and Sentry source-map gates passed; OSS live upload/lifecycle and the human credential-changing submit remain advisory gates. This evidence does not grant production-deployment authority.

### 10.5 Approved Public Release Contract - 2026-07-20

- The user approved an unauthenticated read-only public API without restoring UpdaterServer compatibility.
- Elysia remains the single business-contract owner. `/api/v1` remains administrator-session-only; `/api/public/v1` is a separate release-discovery namespace in the same TanStack Start/Netlify deployment.
- Public consumers can request the highest active numeric version or a specified active canonical version. The manifest exposes only public release/file metadata and 300-second individual OSS signed GET URLs.
- Raw object-key fields, OSS ETags, credentials, download STS, inactive/history rows, global file enumeration, upload operations, and all mutations remain private.
- Browser CORS is an exact no-credentials origin allowlist; native/server requests may omit Origin. Public GET/HEAD requests have a separate IP-based Neon fixed-window limit.
- Production publication requires a formal Netlify Site/domain, canonical `BETTER_AUTH_URL`, `PUBLIC_API_ALLOWED_ORIGINS`, fresh production-context build, and real public/admin negative-path verification.
