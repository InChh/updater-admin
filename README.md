# Updater Admin

Single-tenant updater administration system built with Solid, TanStack Start,
Router, Query, Table, Form and Store; Elysia; Better Auth; Drizzle; Neon; and
Netlify. The authenticated entry page is `/programs`; Dashboard, Billing,
multi-tenancy, legacy updater-client compatibility and automatic OSS deletion
are intentionally out of scope.

The approved product and architecture contract is in
[`docs/aegis/specs/2026-07-14-updater-admin-design.md`](docs/aegis/specs/2026-07-14-updater-admin-design.md).
Durable implementation context, environment requirements and current batch
status live in [`AGENTS.md`](AGENTS.md).

## Local development

Copy `.env.example` to `.env.local`, provision a disposable/local Neon database,
apply migrations, and bootstrap the first administrator before starting the app:

```bash
pnpm install
pnpm db:migrate
pnpm bootstrap:admin
pnpm dev
```

The bootstrap password is one-time configuration. Remove
`BOOTSTRAP_ADMIN_PASSWORD` from every environment immediately after the command
succeeds. Public signup is disabled.

## Verification

```bash
pnpm intent:list
pnpm check
pnpm typecheck
pnpm test
pnpm test:db
pnpm test:e2e
pnpm build
```

`pnpm test:db` is destructive and will run only when both `TEST_DATABASE_URL`
points to a disposable branch and `TEST_DATABASE_CONFIRM_DISPOSABLE` equals
`updater-admin-destructive-tests`. Authenticated E2E suites similarly require a
seeded `E2E_ADMIN_EMAIL` and `E2E_ADMIN_PASSWORD`. Playwright owns isolated port
`3187` by default and refuses to reuse an existing listener; set `E2E_PORT` in
the command environment if that port is unavailable.

## Production build

Builds produce the browser artifact and Netlify SSR function:

```bash
pnpm build
```

Sentry is optional. Browser and server reporting stay disabled when their DSNs
are absent, and a build without Sentry upload credentials does not emit source
maps. When `SENTRY_AUTH_TOKEN`, `SENTRY_ORG`, and `SENTRY_PROJECT` are all set,
the final Vite plugin uploads hidden source maps and deletes local `.map` files
after the upload.

## Environment variables

All values are server-only except `VITE_SENTRY_DSN`:

| Variable | Required | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | yes | Neon/Postgres application connection |
| `BETTER_AUTH_URL` | yes | Exact canonical origin, HTTPS in production |
| `BETTER_AUTH_SECRET` | yes | Strong Better Auth signing secret |
| `BOOTSTRAP_ADMIN_NAME`, `BOOTSTRAP_ADMIN_EMAIL`, `BOOTSTRAP_ADMIN_PASSWORD` | one-time | Creates the first administrator; remove the password immediately afterward |
| `OSS_ACCESS_KEY_ID`, `OSS_ACCESS_KEY_SECRET` | yes for uploads | Permanent server RAM principal; never exposed to the browser |
| `OSS_UPLOAD_RAM_ROLE_ARN`, `OSS_STS_ENDPOINT`, `OSS_BUCKET`, `OSS_REGION`, `OSS_UPLOAD_PREFIX` | yes for uploads | Prefix-scoped browser upload sessions and object verification |
| `VITE_SENTRY_DSN` | optional/public | Enables scrubbed browser error reporting |
| `SENTRY_DSN`, `SENTRY_ENVIRONMENT` | optional pair | Enables scrubbed server error reporting |
| `SENTRY_AUTH_TOKEN`, `SENTRY_ORG`, `SENTRY_PROJECT` | optional group | Enables build-time source-map upload |
| `SENTRY_RELEASE` | optional/local | Local release override; Netlify uses `COMMIT_REF` |
| `APP_VERSION` | optional | Release label shown in authenticated monitoring; Netlify supplies deploy, commit, and context metadata |
| `TEST_DATABASE_URL`, `TEST_DATABASE_CONFIRM_DISPOSABLE` | tests only | Guarded destructive database suite |
| `E2E_ADMIN_EMAIL`, `E2E_ADMIN_PASSWORD` | tests only | Seeded administrator for authenticated Playwright suites |

Never copy `DATABASE_URL`, Better Auth secrets, permanent OSS credentials,
bootstrap passwords, or Sentry auth tokens into a `VITE_*` variable.


## Deploy to Netlify

This project ships with `netlify.toml` configured for a Netlify site:

1. Create separate Neon branches and OSS prefixes for Production and Preview.
2. Import the repository in Netlify and configure the variables above for each
   deploy context.
3. Set `BETTER_AUTH_URL` to the exact canonical HTTPS site origin. Preview
   deployments that exercise authentication need their own exact origin and
   isolated credentials.
4. Run `pnpm deploy:prepare` against the target Neon branch before the first
   deploy and before every migration-bearing release. Requests never run
   migrations during startup.
5. Deploy. Netlify uses `pnpm build`, publishes `dist/client`, and runs TanStack
   Start/Elysia/Better Auth through the generated Netlify Function adapter.
6. Run `pnpm bootstrap:admin` once against the production database, verify the
   login, then remove `BOOTSTRAP_ADMIN_PASSWORD` from every Netlify context.
7. If Sentry is enabled, create browser/server DSNs and an org-scoped source-map
   token, then verify one scrubbed test event and its release mapping.

Before go-live, verify `/health`, protected redirects, an unauthenticated
`/api/v1` response, login/session cookies, Neon readiness, OSS STS readiness,
and the authenticated monitoring page on an authorized Preview deployment.
`netlify.toml` applies the baseline security headers to static assets;
TanStack Start global request middleware applies the same headers to SSR and
Function responses.

## Aliyun OSS direct-upload setup

Release file bodies move directly from the browser to OSS. Netlify receives
only path, SHA-256, byte size, MIME type, deterministic object key and ETag
metadata. Configure a dedicated bucket prefix per environment and do not grant
automatic object deletion.

The permanent RAM principal stored in Netlify needs two separate, narrowly
scoped grants:

- `sts:AssumeRole` on `OSS_UPLOAD_RAM_ROLE_ARN`, so the API can create browser
  upload sessions.
- `oss:GetObject` on
  `acs:oss:*:*:<OSS_BUCKET>/<OSS_UPLOAD_PREFIX>*`, so the server can perform a
  metadata-only HEAD verification before registering an upload.

The second grant belongs only to the permanent server principal and is never
included in browser credentials. The assumed upload role's inline/base
permission must allow only these actions under
`acs:oss:*:*:<OSS_BUCKET>/<OSS_UPLOAD_PREFIX>*`:

- `oss:PutObject`
- `oss:AbortMultipartUpload`
- `oss:ListParts`

The API further supplies a short-lived 900-second session policy with the same
scope. Permanent access keys stay server-only; the browser receives only the
temporary AccessKey ID, secret, security token and expiration.

Multipart requests send `x-oss-forbid-overwrite: true`, but this is only
defense-in-depth because the browser controls its own requests. Production must
also configure an OSS **File overwrite prohibited** rule for the exact
`OSS_UPLOAD_PREFIX`, with no suffix restriction, and restrict every identity
that can assume or use the upload role (use `*` when the prefix is dedicated to
this application). Keep versioning disabled on the bucket because OSS
prevent-overwrite rules do not apply when bucket versioning is enabled or
suspended.
Verify the rule with the assumed upload identity before go-live. The RAM role
and session policy remain prefix-scoped least-privilege controls; neither is a
substitute for the bucket-level overwrite rule. See Alibaba Cloud's
[prevent-overwrite rule documentation](https://www.alibabacloud.com/help/en/oss/user-guide/prevent-file-overwrite).

Cancellation immediately stops the browser request and best-effort aborts a
known multipart `uploadId`. An ID may still be unknown when cancellation races
multipart initialization, and an abort can fail after STS expiry or a network
loss. Production must therefore configure an enabled bucket lifecycle rule for
`OSS_UPLOAD_PREFIX` whose `AbortMultipartUpload` action removes incomplete
multipart uploads after a short bounded period (for example, one day). This
deletes orphaned parts only; it does not delete completed release objects and
does not change the application's no-automatic-object-deletion rule. See the
official guidance for [incomplete multipart cleanup](https://www.alibabacloud.com/help/en/oss/user-guide/delete-parts)
and [bucket lifecycle configuration](https://www.alibabacloud.com/help/en/oss/developer-reference/putbucketlifecycle).

The browser uploader fixes each part at 4 MiB with two parts in flight per file,
so ali-oss cannot silently enlarge part buffers. Its corresponding 10,000-part
limit is 41,943,040,000 bytes per file. Keep shared API/server size validation
at or below that limit; raising it requires a reviewed client memory budget and
part-size change. File-level upload concurrency multiplies the 8 MiB in-flight
part payload budget, and browser/SDK copies add overhead beyond that payload.

Configure OSS bucket CORS for each exact local, Netlify Production and Preview
origin that may upload:

- allowed methods: `PUT`, `POST`, `DELETE`
- allowed headers: `Authorization`, `Content-Type`, `Content-MD5`, and `x-oss-*`
  (or the OSS console's `*` header setting when exact wildcard syntax is not
  supported)
- exposed response headers: `ETag`
- cache/preflight max age: a bounded value such as `600`

Without exposed `ETag`, the client deliberately rejects completion because the
server cannot bind registered metadata to the uploaded object proof. Preview
deployments must use a separate Neon branch and a separate OSS prefix.



## Architecture

- TanStack Start and Router own SSR, file routes, protected nested layouts, and
  the dynamic page-tab shell.
- TanStack Query owns remote API state; Table owns list rendering and sorting;
  Form owns validated mutations; Store owns shell tabs and the upload queue.
- Better Auth exclusively owns identity, passwords, cookies, and sessions.
- Elysia exclusively owns `/api/v1` business authorization and transport.
- Drizzle repositories exclusively own SQL and transactions against Neon.
- Browser uploads go directly to Aliyun OSS with short-lived STS credentials;
  the application server stores and verifies metadata only.

The public `/health` route is deliberately minimal. Database, OSS, build,
release-series, and audit details require an authenticated administrator through
the monitoring routes.

## Linting & Formatting

This project uses [Biome](https://biomejs.dev/) for linting and formatting. The following scripts are available:


```bash
pnpm lint
pnpm format
pnpm check
```
