# Domain and Persistence

> Executable rules for semantic validation, Drizzle state, transactions, and audit evidence.

## Scenario: Change Business State

### 1. Scope / Trigger

Use this contract for changes to programs, versions, draft membership, files,
administrators, settings, audit history, monitoring aggregates, or any Drizzle
schema/repository behavior.

### 2. Signatures

The established separation is visible in the program surface:

```ts
interface ProgramsService {
  create(input: CreateProgramInput, audit: ProgramMutationContext): Promise<EntityResult<ProgramDetailDto>>;
  delete(id: string, ifMatch: string | null, audit: ProgramMutationContext): Promise<DeleteProgramRepositoryResult>;
  getById(id: string): Promise<EntityResult<ProgramDetailDto>>;
  list(search: ProgramListSearch): Promise<ProgramPage>;
  update(id: string, ifMatch: string | null, input: UpdateProgramInput, audit: ProgramMutationContext): Promise<EntityResult<ProgramDetailDto>>;
}

createProgramsService(dependencies?: ProgramsServiceDependencies): ProgramsService
createProgramsRepository(database?: ProgramsDatabase): ProgramsRepository
```

Equivalent service/repository pairs exist under `src/server/domain/` and
`src/server/db/repositories/` for versions, draft files, administrators,
settings, audit, monitoring, and public releases.

### 3. Contracts

#### Domain semantics

- The domain normalizes whitespace, checks well-formed Unicode and NUL safety,
  counts Unicode code points, validates paging/sort literals, and maps
  repository errors into stable domain errors. See
  `src/server/domain/programs.server.ts` and
  `src/server/domain/versions.server.ts`.
- Version numbers are canonical numeric `major.minor.patch` values with no
  leading zeros. Creation and renumbering first reject an exact duplicate of
  another live version as `VERSION_NUMBER_CONFLICT`, then compare against the
  highest finalized, non-deleted version of the same live program. A number
  which is not greater maps to `VERSION_NOT_GREATER`. Soft-deleted draft or
  finalized rows neither reserve a number nor affect the comparison. When
  renumbering, the current live finalized row remains part of that maximum.
- Multiple finalized versions may be active. Latest means the numerically
  highest active version; activating one never disables another.

#### Persistence and lifecycle

- Programs and versions are soft-deleted through `deletedAt`. Live entity,
  version-count/trend, draft-file, and public-release queries exclude the
  relevant deleted programs, versions, and file metadata; deleted versions do
  not affect live version lists/counts, latest release, release trends,
  uniqueness, or monotonic version checks. Retained non-deleted file metadata
  remains part of the physical file/byte totals in
  `src/server/db/repositories/monitoring.server.ts`, even after a historical
  version is soft-deleted; those rows are not exposed through that version's
  file or public-release routes after deletion. Reference
  `src/server/db/repositories/files.server.ts`,
  `src/server/db/repositories/monitoring.server.ts`,
  `src/server/db/repositories/draft-version-files.server.ts`, and
  `src/server/db/repositories/public-releases.server.ts`.
- Known current exception: the version-list `associatedFileCount` scalar in
  `src/server/db/repositories/versions.server.ts` counts `version_files`
  relations without joining live `file_metadata`. Do not copy that query shape
  into new live-business counts. Correcting the existing count and adding a
  deleted-file regression test is a separate source-code task.
- Program deletion soft-deletes its live versions in the same transaction but
  preserves file metadata, version-file history, and OSS objects.
- Draft versions reserve `expectedFileCount`, remain inactive/non-public,
  accept bounded idempotent associations, and finalize only when the unique
  associated path count exactly matches the reservation. Finalized membership
  is immutable.
- Global file reuse is by canonical relative path plus SHA-256, with byte size
  as a consistency check. It is not program-scoped.

#### Transactions, concurrency, and audit

- Program, version, draft-membership, administrator-credential, settings, and
  profile-update mutations execute in repository or credential-unit-of-work
  database transactions. Their database mutation and successful audit event
  commit or roll back together; examples are
  `src/server/db/repositories/programs.server.ts`,
  `src/server/db/repositories/versions.server.ts`, and
  `src/server/db/repositories/draft-version-files.server.ts`. Password change
  is deliberately cross-library rather than globally atomic: Better Auth
  changes the password first, the profile repository sets the forced-password
  marker, Better Auth revokes sessions, then a database transaction clears the
  marker and appends the success audit. Only that final metadata clear and
  audit append are atomic. Failure to set the marker triggers best-effort
  session revocation. Upload credential issuance is another exception: the
  external STS call cannot be part of a database transaction, and the service
  appends its bounded success audit only after STS succeeds.
- Compare the opaque parsed entity tag in the conditional update. Zero updated
  rows must be distinguished as not found versus stale write.
- PostgreSQL unique-constraint classifiers match both SQLSTATE `23505` and the
  exact named constraint; never classify by a message or code alone.
  `isLiveProgramNameUniqueViolation` in
  `src/server/db/repositories/programs.server.ts` also traverses wrapped
  `cause` values with a bounded, cycle-safe search. The direct-error-only
  `isLiveVersionNumberUniqueViolation` implementation in
  `src/server/db/repositories/versions.server.ts` is current debt, not a pattern
  to copy.
- Acquire records in canonical order for multi-row/batched work while
  preserving caller response order.
- Repositories record bounded, redacted before/after values and request
  context. The API audit plugin owns best-effort failed mutation intents; audit
  failure for that failed-intent path, or error-reporting failure, must not mask
  the original API response. Successful repository audits remain transactional
  and are not best effort.

### 4. Validation & Error Matrix

| Condition | Domain/repository result |
|-----------|--------------------------|
| Invalid page, sort, Unicode, path, version, or field bound | domain validation error with stable field paths |
| Live program/version uniqueness violation | named conflict error; do not leak SQL details |
| Version equals another live row | version-number conflict before maximum comparison |
| Version is not above the highest live finalized row | version-not-greater conflict with the current maximum |
| Missing entity | named not-found error |
| Missing entity tag | precondition-required error |
| Malformed or mismatched entity tag | stale-write error |
| Conditional update affects no current row | stale-write or not-found after existence check |
| Draft operation targets finalized version | draft-required/finalized error |
| Finalize count below or above `expectedFileCount` | typed draft-incomplete/count conflict |
| Same draft path maps to conflicting identity | typed path conflict |
| Database/provider exception not explicitly classified | rethrow for centralized sanitized mapping |

### 5. Good / Base / Bad Cases

- Good: repository transaction updates the row, appends a success audit with
  the same transaction handle, returns the stored record, and the domain maps
  dates/bigints into the shared DTO.
- Base: read repository filters every relevant `deletedAt`, uses stable sort
  tie-breakers, and returns a typed record instead of a transport response.
- Bad: an API module performs SQL, a service writes an audit after the
  transaction commits, or deletion removes an OSS object.

### 6. Tests Required

- Pure validation/mapping: adjacent domain tests such as
  `src/server/domain/programs.test.ts`,
  `src/server/domain/versions.test.ts`, and
  `src/server/domain/draft-version-files.test.ts`.
- Query construction/error mapping: adjacent repository unit tests.
- Transaction, isolation, uniqueness, soft deletion, audit atomicity, and
  lifecycle invariants: `*.server.db.test.ts` under the disposable database
  guard.
- Schema constraints: `src/server/db/schema/schema.test.ts` and
  `src/server/db/schema/schema.db.test.ts`; migration changes also run
  `pnpm db:check`.

### 7. Wrong vs Correct

#### Wrong

```ts
await db.update(applications).set(update).where(eq(applications.id, id));
await auditRepository.append(successAudit);
```

#### Correct

```ts
return db.transaction(async (tx) => {
  const updated = await conditionalUpdate(tx, id, expectedVersion, update);
  await createAuditRepository(tx).append(successAudit);
  return updated;
});
```

The correct form makes state and success evidence atomic and preserves
optimistic-concurrency semantics.
