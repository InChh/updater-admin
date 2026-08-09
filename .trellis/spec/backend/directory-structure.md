# Backend Directory Structure

> Executable ownership rules for server and cross-runtime code in this repository.

## Scenario: Add or Move Server-Owned Code

### 1. Scope / Trigger

Use this contract when adding or relocating a TanStack server route, Elysia
module/plugin/schema, domain service, Drizzle repository/schema, auth flow,
provider adapter, security helper, environment reader, or shared wire contract.

### 2. Signatures and Dependency Flow

The stable ownership direction is:

```text
TanStack route -> Elysia module -> domain service -> repository/integration
                                      |
                                      +-> shared wire contract
```

Representative entry points preserve that direction:

```ts
forwardApiRequest(request: Request, handler?: FetchRequestHandler): Promise<Response> | Response
createProgramsModule(dependencies: ProgramsModuleDependencies): Elysia
createProgramsService(dependencies?: ProgramsServiceDependencies): ProgramsService
createProgramsRepository(database?: ProgramsDatabase): ProgramsRepository
```

`/api/auth/*` is the deliberate transport exception: its TanStack route passes
GET and POST directly to Better Auth rather than through Elysia.

The shared administrator client also has an SSR transport boundary rather than
performing an HTTP self-request back into the same Netlify Function.
`src/lib/api/default-fetch.server.ts` rebuilds only a same-origin request,
inherits `authorization`, `cookie`, and `origin` from the active Start request,
retains caller-owned API headers, and forwards directly to Elysia. Its tests
reject cross-origin targets and prove that proxy, referer, user-agent, API-key,
and forwarded-IP headers do not cross. Business leaf routes remain under an
`ssr: false` boundary; do not broaden SSR or inherited headers casually.

### 3. Contracts

#### Server layout

```text
src/
├── routes/api/                 # TanStack Start transport adapters
├── routes/health.ts            # Health transport adapter
├── server/
│   ├── api/
│   │   ├── app.server.ts       # Elysia composition and request forwarding
│   │   ├── modules/            # Resource routes and transport schemas
│   │   ├── plugins/            # Request ID, session, origin, rate limit, audit
│   │   ├── schemas/            # Shared Elysia schema helpers/alignment
│   │   ├── context.server.ts   # Per-request context
│   │   └── problem.ts          # Problem Details mapping
│   ├── auth/                   # Better Auth, safe sessions, bootstrap flows
│   ├── db/
│   │   ├── repositories/       # Queries, transactions, mutation audits
│   │   └── schema/             # Drizzle auth/business/security schemas
│   ├── domain/                 # Semantic validation and service interfaces
│   ├── integrations/           # OSS and Sentry adapters
│   ├── security/               # Response headers and redaction adapters
│   └── env.server.ts           # Typed environment validation
└── shared/
    ├── api/                    # Browser/server DTOs, limits, literals
    ├── security/               # Cross-runtime redaction contracts
    └── uploads/                # Cross-runtime path/object-key helpers
```

Representative paths are `src/server/api/app.server.ts`,
`src/server/domain/versions.server.ts`,
`src/server/db/repositories/versions.server.ts`, and
`src/server/integrations/oss/sts.server.ts`.

#### Ownership

- `src/routes/api/v1/$.ts`, `src/routes/api/public/v1/$.ts`,
  `src/routes/api/public/v2/$.ts`, and `src/routes/health.ts` only forward the
  incoming `Request` to `forwardApiRequest`.
- `src/server/api/app.server.ts` composes global plugins and resource modules.
  Resource-specific validation and SQL do not belong there.
- Modules such as `src/server/api/modules/programs.ts` define transport schemas,
  extract request context, call a domain service, translate known domain errors,
  and set status/headers.
- Services such as `src/server/domain/programs.server.ts` normalize semantic
  input, map repository failures, and expose dependency-injectable interfaces.
- Repositories such as `src/server/db/repositories/programs.server.ts` own
  Drizzle queries, locks, transactions, optimistic writes, and atomic success
  audits. Provider calls stay in `src/server/integrations/`.

#### Boundaries and naming

- Server implementation stays under `src/server/`. A standalone server leaf
  outside that directory uses `.server.ts`, as in
  `src/lib/api/default-fetch.server.ts`. Files already contained by
  `src/server/` need no redundant suffix; `src/server/api/problem.ts` and
  `src/server/integrations/oss/object-key.ts` are current examples.
- Cross-runtime DTOs/constants belong in `src/shared/api/`; do not redefine API
  page sizes, error shapes, lifecycle literals, or upload limits in a module.
- Preserve the approved replacement-system boundary from `AGENTS.md`: do not
  add legacy user/business-data import, ABP/OpenIddict platform APIs, Billing,
  tenancy, download STS, or automatic OSS deletion to any server layer.
- Provider SDK values are normalized into application-owned types and
  secret-free errors before reaching domain/shared code.
- Prefer `createX(dependencies)` factories with lazy defaults. `createApiApp`,
  `createProgramsService`, `createProgramsRepository`, and
  `createUploadStsService` are reference implementations.

### 4. Validation & Ownership Matrix

| Change | Required owner |
|--------|----------------|
| File route or same-origin adapter | `src/routes/` |
| HTTP schema/status/header/error mapping | `src/server/api/modules/` or plugin/problem owner |
| Semantic validation/lifecycle mapping | `src/server/domain/` |
| SQL, row locks, transactions, atomic success audit | `src/server/db/repositories/` |
| Drizzle tables/indexes/checks | `src/server/db/schema/` plus generated migration |
| Better Auth/session/bootstrap | `src/server/auth/` |
| OSS/Sentry SDK interaction | `src/server/integrations/` |
| Browser/server DTO, literal, or limit | `src/shared/` |
| Browser-only workflow/provider client | owning feature with a `.client.ts[x]` implementation behind an explicit client-only boundary |

An ownership mismatch is a review failure even when the code type-checks.

### 5. Good / Base / Bad Cases

- Good: add a shared DTO, mirror it with an exact Elysia schema, validate it in
  a domain service, and persist it through an injected repository transaction.
- Base: add a read-only Elysia module that requires the request session, calls
  one service, maps its DTO, and contains no SQL or provider SDK types.
- Bad: put database access in a route adapter, expose an ali-oss response from a
  domain interface, or duplicate a shared upload limit in the server module.

### 6. Tests Required

- API behavior lives beside its owner, for example
  `src/server/api/app.test.ts`, `src/server/api/modules/programs.test.ts`, and
  `src/server/api/plugins/public-api.server.test.ts`.
- Domain behavior uses adjacent tests such as
  `src/server/domain/programs.test.ts` and
  `src/server/domain/draft-version-files.test.ts`.
- Repository mapping/query behavior uses adjacent `*.server.test.ts`; guarded
  destructive transaction behavior uses `*.server.db.test.ts`.
- A new mirrored Elysia schema needs an `ExactWireShape` compile assertion and
  a wire-level module test. A new route adapter needs forwarding/route coverage.

### 7. Wrong vs Correct

#### Wrong

```ts
// Forbidden route-adapter shape
const rows = await db.select().from(applications);
return Response.json(rows);
```

#### Correct

```ts
// Route adapter
ANY: ({ request }) => forwardApiRequest(request)

// Elysia module
const result = await getProgramsService().list(search);
return { ...result, items: [...result.items] };
```

The correct form preserves transport, semantic, persistence, and wire-contract
ownership. Do not add a legacy UpdaterServer compatibility layer: the admin API
is `/api/v1`, with only the approved public v1/v2 namespaces preserved.
