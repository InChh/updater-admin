# ADR-0001 - Keep Elysia behind the same-origin TanStack Start boundary

Status: `recorded-from-work`
Date: `2026-07-15`

## Source Evidence

- Implemented Batches 4-14, API contract tests, Netlify production builds, and built-function health smoke
## Context

The administration UI needs Better Auth cookies, a canonical Elysia business API, and Netlify hosting without a second deployment. Future maintainers could otherwise move business rules into Start loaders or split Elysia into another service.

## Decision

Deploy one TanStack Start application on Netlify. Keep Better Auth under /api/auth, forward raw same-origin /api/v1 requests through a thin Start transport adapter into the server-only Elysia application, and keep authorization plus business rules in Elysia.

## Alternatives Considered

- Use TanStack Start server functions as the business API owner; rejected because it would duplicate or replace the explicitly requested Elysia contract owner.
- Deploy Elysia as a separate backend origin; rejected because it adds CORS, cross-origin cookie, deployment, and release coordination without a current scaling requirement.
## Consequences

- Authentication cookies and API calls remain same-origin and one deployment owns the release.
- The Start adapter must remain business-rule-free, server-only imports must be protected, and the coupled Netlify function boundary requires build and handler smoke verification.
## Compatibility Boundary

No UpdaterServer route, DTO, error-code, anonymous updater-client, ABP, or OpenIddict compatibility is provided; only the redesigned administration /api/v1 contract is in scope.

## Retirement Impact

Generated demo routes and duplicate API owners are retired; no fallback business transport is retained.

## Baseline Sync

- Needed: needed
- Target: docs/aegis/baseline/2026-07-14-initial-baseline.md
- Action: update baseline
- Reason: The completion append already records Start as transport, Elysia as canonical business owner, same-origin deployment, and excluded compatibility surfaces; this ADR supplies the missing rationale.

## Evidence References

- docs/aegis/specs/2026-07-14-updater-admin-design.md
- docs/aegis/plans/2026-07-14-updater-admin-implementation.md
- docs/aegis/work/2026-07-14-updater-admin-implementation/90-evidence.md
## Boundary

This ADR is an advisory Aegis Method Pack record. It does not grant completion authority or replace project-authoritative architecture sources.
