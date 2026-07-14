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
seeded `E2E_ADMIN_EMAIL` and `E2E_ADMIN_PASSWORD`.

## Production build

Builds produce the browser artifact and Netlify SSR function:

```bash
pnpm build
```


## Deploy to Netlify

This project ships with `netlify.toml` configured for a Netlify site:

1. Push this repo to GitHub
2. Visit https://app.netlify.com/start and import the repo
3. Netlify uses the configured build (`pnpm build` → `dist/client`)
4. Open **Site settings → Environment variables** and add anything from `.env.example` that needs a real value in production
5. Trigger the first deploy

Server functions and API routes run on Netlify Functions. For lower-latency request handling, see Netlify Edge Functions: https://docs.netlify.com/edge-functions/overview.

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



## Routing

This project uses [TanStack Router](https://tanstack.com/router) with file-based routing. Routes are managed as files in `src/routes`.

### Adding A Route

To add a new route to your application just add a new file in the `./src/routes` directory.

TanStack will automatically generate the content of the route file for you.

Now that you have two routes you can use a `Link` component to navigate between them.

### Adding Links

To use SPA (Single Page Application) navigation you will need to import the `Link` component from `@tanstack/solid-router`.

```tsx
import { Link } from "@tanstack/solid-router";
```

Then anywhere in your JSX you can use it like so:

```tsx
<Link to="/about">About</Link>
```

This will create a link that will navigate to the `/about` route.

More information on the `Link` component can be found in the [Link documentation](https://tanstack.com/router/v1/docs/framework/solid/api/router/linkComponent).

### Using A Layout

In the File Based Routing setup the layout is located in `src/routes/__root.tsx`. Anything you add to the root route will appear in all the routes.

More information on layouts can be found in the [Layouts documentation](https://tanstack.com/router/latest/docs/framework/solid/guide/routing-concepts#layouts).

## Server Functions

TanStack Start provides server functions that allow you to write server-side code that seamlessly integrates with your client components.

```tsx
import { createServerFn } from '@tanstack/solid-start'

const getServerTime = createServerFn({
  method: 'GET',
}).handler(async () => {
  return new Date().toISOString()
})
```

## Data Fetching

There are multiple ways to fetch data in your application. You can use TanStack Query to fetch data from a server. But you can also use the `loader` functionality built into TanStack Router to load the data for a route before it's rendered.

For example:

```tsx
import { createFileRoute } from '@tanstack/solid-router'

export const Route = createFileRoute('/people')({
  loader: async () => {
    const response = await fetch('https://swapi.dev/api/people')
    return response.json()
  },
  component: PeopleComponent,
})

function PeopleComponent() {
  const data = Route.useLoaderData()
  return (
    <ul>
      <For each={data().results}>
        {(person) => <li>{person.name}</li>}
      </For>
    </ul>
  )
}
```

Loaders simplify your data fetching logic dramatically. Check out more information in the [Loader documentation](https://tanstack.com/router/latest/docs/framework/solid/guide/data-loading#loader-parameters).

# Demo files

Files prefixed with `demo` can be safely deleted. They are there to provide a starting point for you to play around with the features you've installed.


## Linting & Formatting

This project uses [Biome](https://biomejs.dev/) for linting and formatting. The following scripts are available:


```bash
pnpm lint
pnpm format
pnpm check
```


# Learn More

You can learn more about all of the offerings from TanStack in the [TanStack documentation](https://tanstack.com).

For TanStack Start specific documentation, visit [TanStack Start](https://tanstack.com/start).
