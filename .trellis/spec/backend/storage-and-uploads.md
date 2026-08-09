# Storage and Uploads

> Executable contracts for direct OSS upload, metadata reconciliation, and public releases.

## Scenario: Change Release File Storage or Delivery

### 1. Scope / Trigger

Use this contract for OSS credentials, object keys, hashing/metadata,
draft-file resolve or completion, ambiguous upload verification, finalization,
public release traversal, download signing, and related audit behavior.

### 2. Signatures

```ts
interface UploadsService {
  issueCredentials(input: UploadCredentialsRequest, audit: ProgramMutationContext): Promise<UploadCredentialsResponse>;
}

interface DraftVersionFilesService {
  resolve(programId: string, versionId: string, input: ResolveDraftFilesRequest, audit: ProgramMutationContext): Promise<ResolveDraftFilesResponse>;
  complete(programId: string, versionId: string, input: CompleteUploadsRequest, audit: ProgramMutationContext): Promise<CompleteUploadsResponse>;
  listFiles(programId: string, versionId: string, search: VersionFileCursorSearch): Promise<VersionFileCursorPage>;
}

createUploadStsService(dependencies?: UploadStsServiceDependencies): UploadStsService
createOssMetadataClient(dependencies?: OssMetadataClientDependencies): OssMetadataClient
```

Reference files: `src/server/domain/uploads.server.ts`,
`src/server/domain/draft-version-files.server.ts`,
`src/server/db/repositories/draft-version-files.server.ts`, and
`src/server/integrations/oss/sts.server.ts`,
`src/server/integrations/oss/client.server.ts`, and
`src/server/integrations/oss/download-url.server.ts`.

### 3. Contracts

#### Direct upload and credentials

- Release bytes travel directly from the browser to Aliyun OSS; Netlify
  Functions never proxy artifacts.
- Upload STS is file-agnostic, short-lived, prefix-scoped, and grants only
  `oss:PutObject` and `oss:AbortMultipartUpload`. The permanent application
  identity is limited to `sts:AssumeRole` plus prefix-scoped `oss:GetObject`.
- The default STS duration is 900 seconds and the service accepts configured
  durations only from 900 through 3,600 seconds. One in-memory credential
  manager reuses a still-valid response for the page-owned workflow.
- Required server environment is validated together:
  `OSS_ACCESS_KEY_ID`, `OSS_ACCESS_KEY_SECRET`, `OSS_BUCKET`, `OSS_REGION`,
  `OSS_STS_ENDPOINT`, `OSS_UPLOAD_PREFIX`, and `OSS_UPLOAD_RAM_ROLE_ARN`.
- SDK responses are converted to application types and secret-free integration
  errors before leaving `src/server/integrations/oss/`.
- Production additionally requires bucket-level no-overwrite for the dedicated
  prefix with versioning disabled, an incomplete-multipart lifecycle rule, and
  CORS exposing `ETag` for multipart part completion. These controls never
  delete completed release objects.
- Any explicitly authorized sandbox cleanup uses a separate test-only
  `oss:DeleteObject` identity; never widen the application or upload role.

#### File and batch bounds

- Editable upload exclusions are compiled from root-relative, case-insensitive
  GitIgnore rules in `src/features/versions/upload-exclusions.ts` before files
  enter the queue. Excluded files never reach hashing, resolve, OSS,
  registration, or the finalized manifest.
- The shipped exclusion entries are `lib/acad.dat`, `lib/sysdir.txt`,
  `lib/tm.shx`, `UpdaterTemp/`, `logs/`, and `workdir`. Preserve file and
  directory rules, `*`, `**`, `?`, comments, and ordered `!` negation.
- Edited rules remain in the in-memory upload session. Once the queue contains
  selected files, `src/features/versions/version-form.tsx` locks the rule field;
  the user must clear the current selection before changing exclusions.
- A browser release file is at most 41,943,040,000 bytes.
- The browser uses simple PUT through exactly 8 MiB and multipart above that
  threshold. Multipart uses 4 MiB parts, two in-flight parts per file, and at
  most four concurrently uploading files; hashing, 100-item resolution
  batches, and 25-item registration batches each use a separate concurrency of
  four.
- Hashing publishes completed SHA-256 results to the queue while the remaining
  folder is still being hashed. On each hash completion, it flushes when 16
  results are pending or at least 100 ms has elapsed since the previous flush,
  followed by a final bounded flush; it does not wait for the whole selection
  before updating aggregate state.
- `src/features/versions/hash-worker.ts` reads each browser file in bounded
  4 MiB slices. Do not replace that loop with whole-file `arrayBuffer()` for
  large releases.
- Canonical object keys are at most 1,023 UTF-8 bytes; canonical relative paths
  are bounded and validated before database/provider work.
- Resolve accepts at most 100 files; completion accepts at most 25 proofs.
  These are request/work bounds, never a total release file-count limit.
- Global reuse matches canonical relative path plus SHA-256 and verifies byte
  size consistency in the same database transaction. Any matching live
  metadata row may be associated regardless of program, version lifecycle, or
  prior association. Reuse performs no OSS request.
- Resolve and completion metadata requests in
  `src/features/versions/upload-workflow.client.ts` make at most three attempts
  for fetch-style network failures represented by `TypeError`, or HTTP
  502/503/504, with bounded 500 ms and 1,500 ms backoff. Other errors are not
  retried by this transport helper.
- One row retry restarts every currently failed queue item across hashing,
  resolution, upload, and registration. Cancelled peers stay cancelled unless
  the clicked row is itself the cancelled item.

#### Completion and finalization

- Normal successful upload completion registers metadata directly and stores
  no final-object ETag.
- Both the simple `put` and multipart upload paths in
  `src/features/versions/oss-uploader.client.ts` send
  `x-oss-forbid-overwrite: true`. Deterministic path/checksum object keys make
  identical content idempotent, but the browser-controlled header is only
  defense in depth and does not replace the bucket-level no-overwrite rule.
- Only an explicitly ambiguous recovery item sets `verifyObject: true`; then
  the server performs OSS HEAD with default/max concurrency 16 and validates
  byte size. The ali-oss metadata client uses an 8-second timeout and SDK retry
  maximum 2; provider timeout/failure remains a typed unavailable result rather
  than permission to register unverified metadata.
- Missing-object recovery keeps `UPLOAD_OBJECT_NOT_FOUND` as the problem code
  and `OBJECT_NOT_FOUND` on the item field. Metadata/path conflicts must not
  cause the client to upload again under another identity.
- Draft resolve/completion is bounded, idempotent, audited, and transactional.
  Finalization requires the exact unique path count and makes membership
  immutable.
- Credential, resolve, completion, and finalization success audits contain
  bounded, secret-free count/lifecycle summaries and request context; they do
  not record credentials, object keys, relative paths, or checksums. Resolve,
  completion, and finalization commit their database state with the audit.
- Application deletion never deletes completed OSS objects.

Server OSS adapters keep `ali-oss` as a static import in
`src/server/integrations/oss/client.server.ts` and
`src/server/integrations/oss/download-url.server.ts`. A dynamic
`createRequire(import.meta.url)("ali-oss")` is not visible to Netlify's NFT
trace and must not be reintroduced.

#### Public delivery

- Public v1 remains wire-compatible and returns the complete manifest for the
  highest active release or a specified active canonical version, with
  300-second signed GET URLs. Do not truncate or repurpose it during the v2
  migration.
- Public v2 returns a header, cursor-pages complete metadata (maximum 500), and
  signs at most 100 client-selected paths per request with the same 300-second
  URL lifetime. Metadata pages default to 200. It has no total file cap. Each
  finalized v2 manifest is independently reconstructable: paths absent from a
  newer manifest are removed by the client rather than represented as release
  deltas.
- Public URL signing preserves file/request order while bounding concurrent
  OSS signing calls to eight in `src/server/domain/public-releases.server.ts`;
  `src/server/domain/public-releases.test.ts` verifies the bound. This provider
  concurrency limit does not reduce v1 manifest completeness or v2's 100-item
  request limit.
- A release that cannot be safely consumed through preserved public v1 must
  not be activated until v2-capable updater clients have shipped. This rollout
  gate is external to the administration API and must remain explicit in
  release verification; it does not imply a server-side v1 truncation or cap.
- Both versions are exact-origin CORS, IP-rate-limited, `no-store`, and expose
  only live finalized active release data. Neither exposes object keys,
  credentials, upload endpoints, OSS ETags, or administrator DTOs.
- The shared public limit is 120 accepted read/signing requests per 60 seconds
  per extracted client IP (or the bounded unknown-IP bucket). Browser requests
  must match the configured exact origin; requests without `Origin` remain
  valid for native/server clients.

### 4. Validation & Error Matrix

| Condition | Result |
|-----------|--------|
| Invalid OSS configuration or malformed provider response | secret-free integration error |
| STS AssumeRole/network failure | `UPLOAD_CREDENTIALS_UNAVAILABLE` / typed `503` |
| Invalid authenticated upload/resolve/completion file, key, path, MIME, SHA, batch, or byte size | `422 VALIDATION_FAILED` with bounded item path |
| Draft/finalized state mismatch | typed lifecycle problem |
| Canonical path maps to conflicting identity | typed path/metadata conflict |
| `verifyObject: true` and HEAD returns 404 | `409 UPLOAD_OBJECT_NOT_FOUND` + item `OBJECT_NOT_FOUND` |
| Ambiguous HEAD unavailable/times out | `503 UPLOAD_VERIFICATION_UNAVAILABLE` |
| Public release not live/finalized/active | `404 NOT_FOUND` |
| Malformed or unknown public cursor anchor | `400 BAD_REQUEST` |
| Well-shaped v2 path/checksum selection absent from the release | `404 NOT_FOUND` |

### 5. Good / Base / Bad Cases

- Good: resolve a 100-item batch transactionally; reuse every matching row;
  request one credential set only when changed files remain; complete in
  25-item batches; finalize after the exact association count is present.
- Base: all files are reusable, causing zero OSS, STS, PUT, and HEAD calls.
- Bad: HEAD every successful upload, store OSS ETags, mint file-specific STS,
  proxy bytes through the API, cap total release membership, or delete OSS on
  record deletion.

### 6. Tests Required

- Shared limits/object-key/path normalization:
  `src/shared/api/uploads.test.ts` and
  `src/server/integrations/oss/oss.test.ts`.
- Upload-exclusion defaults, GitIgnore semantics, matching, and session state:
  `src/features/versions/upload-exclusions.test.ts` and
  `src/features/versions/version-form.test.tsx`.
- Domain batching, idempotency, ambiguity, and error mapping:
  `src/server/domain/draft-version-files.test.ts` and
  `src/server/domain/uploads.test.ts`.
- Browser hashing, bounded concurrency, metadata retry, aggregate row retry,
  and all-reused behavior:
  `src/features/versions/upload-workflow.client.test.ts`.
- Repository transaction/reuse/conflict behavior:
  `src/server/db/repositories/draft-version-files.server.db.test.ts`.
- STS policy/SDK normalization/HEAD behavior:
  `src/server/integrations/oss/sts.test.ts`,
  `src/server/integrations/oss/sts-client.test.ts`, and
  `src/server/integrations/oss/oss.test.ts`.
- Public visibility, pagination, cursor, and signing:
  public release API/domain/repository unit and DB tests.
- Real OSS CORS, multipart, no-overwrite, lifecycle, Netlify, and signed GET
  checks remain environment-backed and must never be claimed from mocks.

Current environment debt: the last recorded nonproduction OSS proof in
`AGENTS.md` allowed upload but did not expose `ETag` through bucket CORS, and
the application principal cannot inspect that configuration. An environment
operator must verify/fix CORS and lifecycle policy without widening either
application role; local tests do not close that gate.

### 7. Wrong vs Correct

#### Wrong

```ts
for (const file of files) {
  await oss.head(file.objectKey);
  await repository.register(file);
}
```

#### Correct

```ts
const ambiguous = files.filter((file) => file.verifyObject === true);
await verifyAmbiguousObjects(ambiguous, boundedConcurrency);
return repository.complete({ files, audit });
```

The correct form keeps the normal path database-only and reserves OSS HEAD for
explicitly ambiguous recovery.
