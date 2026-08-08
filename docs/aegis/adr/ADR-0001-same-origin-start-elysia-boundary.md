# ADR-0001 - Keep Elysia behind the same-origin TanStack Start boundary

Status: `amended`
Date: `2026-07-15`
Amended: `2026-07-19`

## Source Evidence

- Implemented Batches 4-14, API contract tests, Netlify production builds, built-function health smoke, and the 2026-07-19 Netlify request-header platform finding. A real authenticated browser concurrency mutation through Preview remains the release acceptance gate.

## Context

The administration UI needs Better Auth cookies, a canonical Elysia business API, and Netlify hosting without a second deployment. Future maintainers could otherwise move business rules into Start loaders or split Elysia into another service.

## Decision

Deploy one TanStack Start application on Netlify. Keep Better Auth under /api/auth, forward raw `/api/v1` and `/api/public/v1` requests through thin Start transport adapters into the server-only Elysia application, and keep authorization plus business rules in Elysia. Administrator requests remain same-origin; only the public read namespace applies explicit CORS.

## 2026-07-19 Amendment: request-scoped SSR and concurrency transport

- Browser `/api/v1/*` requests continue through the thin same-origin Start route. SSR API calls default to a request-scoped direct Elysia bridge that inherits only `authorization`, `cookie`, and `origin`, rejects cross-origin targets, and avoids an HTTP self-request into the same Netlify Function.
- The Netlify Functions proxy strips the standard `If-Match` request header before the handler. Every optimistic-concurrency mutation therefore sends the application-owned `X-Updater-If-Match` header.
- Client and server share `UPDATER_IF_MATCH_HEADER` from `src/shared/api/common.ts`. The server reads only that header; it must not dual-read standard `If-Match` as a compatibility fallback.
- Missing `X-Updater-If-Match` returns `428 PRECONDITION_REQUIRED`; a stale value returns `409 STALE_WRITE`. Detail GETs and entity-returning mutations continue to expose the standard `ETag` response header, while successful DELETE remains a headerless `204`.
- Domain/service/repository parameters remain named `ifMatch`: that name represents the internal precondition concept and does not redefine the wire header.
- Release acceptance requires a real authenticated browser -> Netlify Preview -> Function mutation that commits state with `X-Updater-If-Match` and returns the next standard `ETag`. Direct Elysia tests, mocked browser routing, local development, and built-handler smoke are supporting evidence only.

## Alternatives Considered

- Use TanStack Start server functions as the business API owner; rejected because it would duplicate or replace the explicitly requested Elysia contract owner.
- Deploy Elysia as a separate backend origin; rejected because it adds CORS, cross-origin cookie, deployment, and release coordination without a current scaling requirement.
- Send SSR calls through the deployed Function URL; rejected because it creates an unnecessary self-request and re-enters the platform proxy instead of using the active request context.
- Keep standard `If-Match` or dual-read standard/custom request headers; rejected because Netlify removes the standard header and a fallback would hide an unverified or broken Preview transport contract.

## Consequences

- Authentication cookies and API calls remain same-origin and one deployment owns the release.
- Anonymous release discovery remains in the same deployment and Elysia owner under `/api/public/v1`; CORS is scoped only to that read-only namespace and never carries administrator cookies.
- The Start adapter must remain business-rule-free, server-only imports must be protected, and the coupled Netlify function boundary requires build and handler smoke verification.
- Browser and SSR transports remain separate mechanisms with one Elysia contract owner. The SSR bridge is request-scoped and least-inheritance; the browser path remains the required platform acceptance surface.
- Request preconditions use an application-owned header because of the platform exception, while response cache/concurrency discovery remains standards-based through `ETag`.

## Compatibility Boundary

No UpdaterServer route, DTO, error-code, anonymous updater-client, ABP, or OpenIddict compatibility is provided. The 2026-07-20 `/api/public/v1` release manifest is a new contract, not a compatibility alias: it exposes active release metadata and short-lived individual signed URLs only. The redesigned administration `/api/v1` contract remains session-protected. Standard `If-Match` is not retained as a compatibility request path.

## Retirement Impact

Generated demo routes and duplicate API owners are retired; no fallback business transport, Function self-request, or standard/custom precondition dual-read is retained.

## Baseline Sync

- Needed: needed
- Target: docs/aegis/baseline/2026-07-14-initial-baseline.md
- Action: update baseline
- Reason: The completion append already records Start as transport, Elysia as canonical business owner, same-origin deployment, and excluded compatibility surfaces; this ADR supplies the missing rationale.

### 2026-07-19 Amendment Closure

- Required: yes
- Target checked: `docs/aegis/baseline/2026-07-14-initial-baseline.md`
- Action: cite baseline unchanged; update `AGENTS.md`, the approved design, this plan, and this ADR as the wire-contract owners
- Reason: the baseline records the still-correct Start/Elysia owner map but does not name the precondition request header. The wire-level Netlify exception and its verification gate belong in the updated contract/decision surfaces.

### 2026-07-20 Public Contract Amendment

- Decision: keep one Netlify/Start/Elysia deployment and add a separate anonymous read-only `/api/public/v1` group outside the administrator session group.
- Security boundary: explicit no-credentials origin allowlist for browser callers, IP-based fixed-window limiting, active/live release filtering, 300-second single-object signed URLs, and no download STS or administrative DTO reuse.
- Rejected alternative: weakening selected `/api/v1` routes, because it would mix administrator and public contracts and make future authorization changes unsafe.
- Baseline sync: append the approved public-contract scope while retaining the no-legacy-compatibility and single API-owner rules.

## Evidence References

- docs/aegis/specs/2026-07-14-updater-admin-design.md
- docs/aegis/plans/2026-07-14-updater-admin-implementation.md
- docs/aegis/work/2026-07-14-updater-admin-implementation/90-evidence.md
- src/shared/api/common.ts
- src/lib/api/client.ts
- src/lib/api/default-fetch.server.ts
- src/server/api/preconditions.ts

## Boundary

This ADR is an advisory Aegis Method Pack record. It does not grant completion authority or replace project-authoritative architecture sources.
