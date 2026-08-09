# Backend Development Guidelines

> Verified server and cross-layer conventions for Updater Admin.

## Overview

Updater Admin is a full-stack TanStack Start application. TanStack server
routes are transport adapters; Elysia owns the business HTTP API, domain
services own semantic validation, Drizzle repositories own persistence, and
provider integrations remain server-only.

## Guidelines Index

| Guide | Description | Status |
|-------|-------------|--------|
| [Directory Structure](./directory-structure.md) | API, domain, repository, schema, and integration ownership | Complete |
| [API Contracts](./api-contracts.md) | Elysia namespaces, DTO alignment, errors, preconditions, public APIs | Complete |
| [Domain and Persistence](./domain-and-persistence.md) | Validation, transactions, audit, soft deletion, release lifecycle | Complete |
| [Auth and Security](./auth-and-security.md) | Better Auth, session policy, origin checks, secrets, redaction | Complete |
| [Storage and Uploads](./storage-and-uploads.md) | OSS STS, direct upload, reconciliation, public release delivery | Complete |
| [Quality and Operations](./quality-and-operations.md) | Tests, migrations, deployment, observability, environment gates | Complete |

## How to Use These Guidelines

1. Read every guide that intersects the change; backend work commonly spans
   API, domain, persistence, and provider boundaries.
2. Treat `src/shared/api/` as the wire-contract owner and the cited server
   files as reference implementations.
3. Preserve the approved product boundaries in `AGENTS.md`; do not infer
   compatibility with UpdaterServer or updater clients beyond the documented
   public v1 and v2 APIs.
4. Run local checks and report environment-backed gates separately.

These documents describe current production-owned behavior, not a proposed
future architecture.

## Authority Boundary

Read `AGENTS.md` before substantial backend work. It remains authoritative for
approved product decisions, compatibility exclusions, environment variables,
scaffold/package constraints, deployment history, provider-owner follow-ups,
and release/production gates. These backend guides record the stable,
source-backed implementation contracts for this layer and intentionally
delegate those time-sensitive operational facts to `AGENTS.md` rather than
copying snapshots that can drift.

**Language**: All documentation should be written in **English**.
