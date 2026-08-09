# Backend API Contracts

> Executable rules for the Elysia API and its TanStack Start adapters.

## Scenario: Add or Change an HTTP Contract

### 1. Scope / Trigger

Use this contract whenever a change adds or modifies an administrator route,
public release route, DTO, validation rule, response header, error code, CORS
rule, rate limit, or optimistic-concurrency mutation.

### 2. Signatures

The API is composed and forwarded through these stable entry points:

```ts
createApiApp(dependencies?: ApiAppDependencies): Elysia
forwardApiRequest(request: Request, handler?: FetchRequestHandler): Promise<Response> | Response
createProgramsModule(dependencies: ProgramsModuleDependencies): Elysia
mapApiError(context: ApiErrorContext, dependencies: ProblemMapperDependencies): Promise<Response>
readUpdaterIfMatch(request: Request): string
```

Reference implementations:
`src/server/api/app.server.ts`, `src/server/api/modules/programs.ts`,
`src/server/api/problem.ts`, and `src/server/api/preconditions.ts`.

### 3. Contracts

#### Namespaces and transport

- `/health` is unauthenticated liveness.
- `/api/auth/*` belongs to Better Auth.
- `/api/v1/*` is the authenticated administration API.
- `/api/public/v1/*` is the preserved anonymous complete-manifest contract.
- `/api/public/v2/*` is the additive anonymous header, cursor-page metadata,
  and selective-download-signing contract.
- The `/health`, `/api/v1/*`, and public TanStack route files forward `Request`
  objects unchanged to Elysia. The `/api/auth/*` adapter instead forwards GET
  and POST directly to Better Auth. Within Elysia, plugins own administrator
  session authorization plus origin, rate-limit, and failure-audit policy;
  resource modules and domain services own input validation, while modules and
  the centralized problem mapper own response/error construction.

#### DTO and schema alignment

- camelCase DTOs, literals, bounds, and `Page<T>` shapes live in
  `src/shared/api/`.
- Elysia `t.Object` schemas use `additionalProperties: false` at request and
  response trust boundaries.
- Mirrored schemas use `ExactWireShape<Static<typeof schema>, Dto>` assertions
  from `src/server/api/schemas/alignment.ts`; see
  `src/server/api/modules/programs.ts` and
  `src/server/api/modules/public-releases.ts`.
- Transport length caps may be safely coarse when the domain owns a stricter
  Unicode-code-point rule. Do not replace semantic validation with UTF-16
  `String.length` checks.

#### Headers and errors

- Authenticated entity-detail GETs and entity-returning mutations emit standard
  `ETag` responses. Anonymous public release responses do not expose entity
  tags.
- Mutations read only `UPDATER_IF_MATCH_HEADER` (`X-Updater-If-Match`) from
  `src/shared/api/common.ts`. Never accept standard `If-Match` as a fallback.
- Errors are bounded Problem Details with `application/problem+json`,
  `cache-control: no-store`, `x-request-id`, stable `code`, numeric `status`,
  and sanitized field paths. Unknown errors become `INTERNAL_ERROR` and are
  reported without exposing the thrown value to the client.
- Public responses are `no-store`. Browser origins must exactly match the
  canonical `PUBLIC_API_ALLOWED_ORIGINS` allowlist; native/server requests
  without `Origin` remain valid. Production (`NODE_ENV` or Netlify `CONTEXT`)
  accepts only HTTPS allowlist origins. Localhost HTTP is allowed only outside
  production, and a malformed entry rejects the complete configuration. See
  `src/server/env.server.ts`, `src/server/env.server.test.ts`, and
  `src/server/api/plugins/public-api.server.test.ts`.

#### Program list and mutation contract

- Program pages are `1..1,000,000`; page sizes are `20`, `50`, or `100`.
- The optional name filter is a case-sensitive literal substring. Escape SQL
  `LIKE` wildcard characters and sort stably by `createdAt` then `id`.
- Program name/description bounds use Unicode code points and reject NUL or
  ill-formed Unicode at the domain boundary.
- A successful program delete returns an empty `204` response without an
  `ETag`; detail and entity-returning mutations keep the standard response
  header. Reference `src/shared/api/programs.ts`,
  `src/server/domain/programs.server.ts`, and
  `src/server/db/repositories/programs.server.ts`.

#### Public v2 limits

- Metadata pages default to 200 and cap at 500.
- Selective signing accepts at most 100 requested paths.
- Public visibility requires a live program, a live finalized active version,
  a non-null `finalizedAt`, and live file metadata.
- Cursor values are opaque base64url canonical paths; do not expose object keys.

### 4. Validation & Error Matrix

| Condition | HTTP/result contract |
|-----------|----------------------|
| Missing administrator session | `401 UNAUTHENTICATED` |
| Non-admin, banned user, or disallowed forced-password route | `403 FORBIDDEN` |
| Unsafe `/api/v1` mutation origin | `403 FORBIDDEN` |
| Missing `X-Updater-If-Match` | `428 PRECONDITION_REQUIRED` |
| Stale entity tag | `409 STALE_WRITE` |
| Domain uniqueness/lifecycle conflict | typed `409` problem code |
| Malformed JSON | `400 BAD_REQUEST` |
| Invalid transport/domain input | `422 VALIDATION_FAILED` with bounded `fieldErrors` |
| Malformed or unknown public cursor anchor | `400 BAD_REQUEST` |
| Missing resource or non-public release | `404 NOT_FOUND` |
| Well-shaped public v2 download selection that does not exactly match the live release | `404 NOT_FOUND` |
| Exhausted public/API rate limit | `429 RATE_LIMITED` plus rate headers |
| Provider/readiness outage mapped by the route | typed `503` problem |
| Unexpected server error | sanitized `500 INTERNAL_ERROR`, capture failure ignored |

The mapper is implemented in `src/server/api/problem.ts`; resource-specific
error translation stays beside each module.

### 5. Good / Base / Bad Cases

- Good: add a field first to `src/shared/api/programs.ts`, update the Elysia
  schema and `ExactWireShape` assertion, update domain mapping, then cover the
  wire response in `src/server/api/modules/programs.test.ts`.
- Base: a read-only module requires a session, calls a domain service, returns a
  DTO, and declares its exact 200 response schema.
- Bad: return a Drizzle row, provider error, raw exception message, OSS object
  key, secret, or administrator-internal DTO through a public route.

### 6. Tests Required

- Module tests assert status, response body, response schema, `ETag`, location,
  precondition header behavior, and domain-error mapping.
- `src/server/api/app.test.ts` covers composition, auth boundaries, request IDs,
  origin enforcement, and sanitized failures.
- `src/server/api/app.public-releases.test.ts` and
  `src/server/api/modules/public-releases.test.ts` cover public v1/v2 routing,
  CORS/no-store behavior, pagination, and signing request limits.
- `src/shared/api/*.test.ts` covers shared literal/limit helpers.
- A public-v1 change requires explicit compatibility review; v2 must remain
  additive until the client rollout gate is satisfied.

### 7. Wrong vs Correct

#### Wrong

```ts
const ifMatch = request.headers.get("if-match") ??
  request.headers.get("x-updater-if-match");
return repository.update(body);
```

#### Correct

```ts
const ifMatch = readUpdaterIfMatch(request);
const result = await service.update(id, ifMatch, body, audit);
set.headers.etag = result.etag;
return result.data;
```

The correct form preserves the Netlify header exception, domain ownership, and
standard response `ETag` contract.
