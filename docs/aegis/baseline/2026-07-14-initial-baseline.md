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
