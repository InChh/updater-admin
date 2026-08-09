# Authentication and Security

> Executable server rules for accounts, sessions, origins, secrets, and redaction.

## Scenario: Change Authentication or a Security Boundary

### 1. Scope / Trigger

Use this contract for Better Auth configuration, administrator lifecycle,
session handling, password changes/resets, bootstrap, mutation-origin checks,
security headers, audit payloads, Sentry events, and environment secrets.

### 2. Signatures

```ts
createAuth(dependencies?: CreateAuthDependencies): AppAuth
getSafeSession(headers: Headers, dependencies?: SafeSessionDependencies): Promise<SafeSessionView | null>
bootstrapAdministratorFromEnvironment(dependencies?: BootstrapFromEnvironmentDependencies): Promise<BootstrapResult>
createSessionPlugin(dependencies: SessionPluginDependencies): Elysia
createOriginPlugin(dependencies?: OriginPluginDependencies): Elysia
```

Reference files: `src/server/auth/auth.server.ts`,
`src/server/auth/session.server.ts`, `src/server/auth/bootstrap.server.ts`,
`src/server/api/plugins/session.server.ts`, and
`src/server/api/plugins/origin.server.ts`.

### 3. Contracts

#### Account and session policy

- Better Auth owns `/api/auth`, uses the Drizzle adapter and UUIDs, and has
  public sign-up disabled. Email/password is enabled with 12-128 character
  passwords and `autoSignIn: false`.
- The admin plugin has one valid application role: `admin`. There is no
  Owner/Admin/Viewer RBAC or tenant boundary.
- Cookies are HttpOnly, SameSite=Lax, and Secure when `BETTER_AUTH_URL` is
  HTTPS. Only the canonical application origin is trusted. Production is
  identified by either `NODE_ENV=production` or Netlify `CONTEXT=production`
  and rejects a non-HTTPS `BETTER_AUTH_URL`; loopback HTTP is accepted only
  outside production. Preserve the validation in `src/server/env.server.ts`
  and `src/server/env.server.test.ts`.
- Database-backed auth rate limiting protects sign-in and the general auth
  surface.
- The authenticated Elysia API has separate database fixed-window protection
  for high-risk operations, keyed by administrator user ID: profile password
  change, administrator creation, and administrator password reset allow five
  requests per 15 minutes; upload credential issuance allows ten per five
  minutes. Preserve the policies and `RateLimit-*`/`Retry-After` response
  behavior in `src/server/api/plugins/rate-limit.server.ts` and
  `src/server/api/plugins/rate-limit.test.ts`; full application enforcement is
  covered in `src/server/api/app.test.ts`.
- `SafeSessionView` is the only session view passed into API request context;
  do not expose Better Auth internal session/user objects to feature code.
- Banned or non-admin accounts receive `403`. A temporary-password account may
  call only `GET /api/v1/profile` and
  `POST /api/v1/profile/change-password` until the password is changed.
- Client `beforeLoad` guards are navigation UX only. The Elysia session plugin
  remains the authorization boundary for every `/api/v1` request, including
  requests issued outside the Router.

Better Auth owns identity, password credentials, sessions, and banned/disabled
state. Drizzle-owned `admin_metadata` owns locale, `mustChangePassword`,
`lastLoginAt`, and the optimistic `rowVersion` for administrator/profile policy
mutations. Preserve this split rather than copying Better Auth fields into a
second application table; see `src/server/db/schema/auth.ts`,
`src/server/auth/session.server.ts`, and
`src/server/db/repositories/administrators.server.ts`.

#### Administrator creation and bootstrap

- Public registration and raw Better Auth administrative password/session
  endpoints listed in `AUTH_HTTP_DISABLED_PATHS` remain disabled.
- Authenticated administrators use the application-owned administrator service
  and credential unit of work to create/reset accounts with temporary
  passwords, revoke sessions, update metadata, and audit the action atomically.
- Initial bootstrap reads one-time `BOOTSTRAP_ADMIN_NAME`,
  `BOOTSTRAP_ADMIN_EMAIL`, and `BOOTSTRAP_ADMIN_PASSWORD`, validates auth
  secrets before the transaction, and takes a PostgreSQL advisory transaction
  lock. It creates only in an empty account store. An idempotent rerun with the
  same single email, `admin` role, non-banned state, and
  `mustChangePassword: false` metadata returns `already-exists`; the display
  name is not part of that idempotency check. Any other non-empty or
  incompatible state fails closed. After a successful bootstrap, remove the
  three `BOOTSTRAP_ADMIN_*` values from the deployed environment; they are a
  one-time bootstrap input, not a reusable account-management path.

#### Origin, secrets, and redaction

- Non-safe `/api/v1` methods require an `Origin` exactly equal to
  `BETTER_AUTH_URL`. Missing, malformed, credential-bearing, path-bearing, or
  cross-origin values are forbidden.
- Environment readers in `src/server/env.server.ts` validate groups lazily at
  the owner boundary. Never read secrets in browser/isomorphic code or copy
  secret values into audit/Sentry errors.
- Audit before/after values pass through `redactSensitiveData`; Sentry uses the
  same redaction contract and bounded request context.
- `src/server/security/headers.ts` is the server response-header source of
  truth; dynamic responses must retain these headers in addition to Netlify
  static header configuration.

### 4. Validation & Error Matrix

| Condition | Result |
|-----------|--------|
| Missing/invalid `BETTER_AUTH_SECRET` or `BETTER_AUTH_URL` | `EnvironmentValidationError` naming variables only |
| Sign-up attempt | disabled Better Auth route |
| Missing session | `401 UNAUTHENTICATED` |
| Wrong role or banned account | `403 FORBIDDEN` |
| Temporary password on unrelated API route | `403 FORBIDDEN` |
| Unsafe mutation origin | `403 FORBIDDEN` |
| Bootstrap against exactly one matching email/admin/non-banned/non-temporary row | `{ status: "already-exists", userId }` |
| Bootstrap against multiple or incompatible account rows | `BootstrapStateError` |
| Weak temporary/bootstrap password | validation/credential error without password echo |
| Failed-intent audit or Sentry reporter fails | original auth/API outcome remains authoritative |

### 5. Good / Base / Bad Cases

- Good: an administrator reset runs through
  `src/server/auth/administrator-credentials.server.ts`, updates credential
  metadata, revokes sessions, and appends a redacted audit in one unit of work.
- Base: `getSafeSession` returns only serializable safe fields and separate
  application metadata needed by the session plugin.
- Bad: enable Better Auth sign-up, call disabled raw admin endpoints from the
  UI, introduce role-based product permissions, or log passwords/tokens.

### 6. Tests Required

- Better Auth configuration, disabled paths, session hooks, safe-session
  projection, and bootstrap state/locking: `src/server/auth/auth.test.ts`.
- Better Auth's required Zod 4 runtime metadata compatibility:
  `src/server/auth/zod-runtime.test.ts`.
- Temporary-password creation/reset and audit:
  `src/server/auth/administrator-credentials.test.ts` plus repository DB tests.
- API session/origin/error boundaries: `src/server/api/app.test.ts` and plugin
  tests.
- Redaction/security headers/Sentry isolation:
  `src/server/security/*.test.ts` and
  `src/server/integrations/sentry/*.test.ts`.

### 7. Wrong vs Correct

#### Wrong

```ts
console.error("bootstrap failed", password, error);
return auth.api.createUser(body);
```

#### Correct

```ts
const result = await credentialService.createTemporaryPasswordAdministrator(
  validatedInput,
  audit,
);
return result;
```

The correct path preserves validation, forced password change, session policy,
transactional audit, and secret redaction.
