# Technical Design: Unlimited release folders with incremental OSS reuse

## Summary
- Replace the current fixed 5,000-file ceiling and full-array version finalization with a draft-version lifecycle: create a draft, resolve/associate reusable files in bounded batches, upload only missing or changed files directly to OSS, register them in bounded batches, and atomically finalize the draft without ever sending the full file list in one request.
- Decouple prefix-scoped STS issuance from per-file object-target calculation. One in-memory credential manager serves the whole upload workflow and refreshes through `ali-oss` only when the current credential window is near expiration. Public release consumption moves to an additive cursor-paginated v2 manifest so total release size is not bounded by one Netlify response.
- This is Option A selected by the user. It has a larger but controlled change surface than merely removing constants, and it is the only option considered that removes the total-count ceiling end to end rather than moving it to another request, SQL statement, audit row, or manifest response.

## Goals
- Remove every application-level total file-count cap from folder selection, version composition, and public manifest traversal.
- Keep all browser-to-backend requests, PostgreSQL statements, upload-proof OSS HEAD work, audit payloads, and public responses bounded per request.
- Issue one prefix-scoped STS credential set per validity window and coalesce refreshes; do not issue credentials per artificial file batch.
- Support incremental upload: when a selected file with the same canonical relative path, SHA-256, and byte size already belongs to a prior finalized version of the same program, treat its previously verified immutable metadata row as authoritative, associate it with the new draft, and skip upload without another synchronous OSS request.
- Keep each finalized version a complete, self-contained manifest. Incremental behavior reuses physical OSS objects and skips unchanged client downloads; it does not create a chain of delta releases.
- Make upload recovery durable at the draft/version-association level. After a refresh or dialog close, reselecting the intended folder must mark already-associated/reusable files complete and upload only the remaining files.
- Preserve server-side canonical object-key validation, exact size verification, optional ETag verification, idempotent metadata registration, overwrite prohibition, soft deletion, auditability, and multiple independently active versions.
- Preserve existing public v1 behavior during a coordinated migration while providing a scalable v2 contract for releases of any practical size.

## Non-Goals
- Persist browser `File` objects, file contents, multipart checkpoints, or temporary STS secrets in PostgreSQL, localStorage, or sessionStorage.
- Proxy file bodies through Netlify Functions.
- Introduce a separate upload-session aggregate or per-draft OSS prefix; the selected draft version is the durable workflow identity.
- Automatically delete OSS objects, including abandoned-draft objects.
- Reuse a file solely because its filename or size matches; SHA-256 remains mandatory.
- Reuse a same-content object at a different relative path. The canonical OSS key contains both SHA-256 and normalized path.
- Allow file membership of a finalized version to mutate. File changes require a new version; finalized metadata/activation controls remain editable within existing rules.
- Preserve compatibility with the legacy UpdaterServer protocol.

## Current Code Context
- `src/features/versions/folder-picker.tsx:62-91` — normalizes and sorts a selected directory but currently rejects more than `MAX_UPLOAD_FILES`.
- `src/features/versions/version-form.tsx:136-152,224-245,545-569` — repeats the total-count validation, waits for uploads, then collects every completed metadata ID for one final request.
- `src/features/versions/upload-workflow.client.ts:236-245,421-477,675-693` — caches only the most recent authorization map and requests a new credential response per 1,000 ready files.
- `src/features/versions/upload-workflow.client.ts:578-618` — already splits completion into sequential 25-file batches; this bounded behavior is retained.
- `src/features/versions/oss-uploader.client.ts:300-304,347-412` — creates cancellable per-file `ali-oss` multipart clients, uses two parts per file, retains checkpoints only in memory, and forbids overwrite.
- `src/server/integrations/oss/sts.server.ts:162-185,242-298` — current policy already grants `PutObject` and `AbortMultipartUpload` across the complete configured upload prefix, but every endpoint call performs a fresh 900-second AssumeRole.
- `src/server/integrations/oss/object-key.ts:33-61` — canonical object keys are deterministic from upload prefix, SHA-256, and normalized percent-encoded relative path.
- `src/server/domain/uploads.server.ts:268-303,449-525,538-645` — credential issuance currently combines target calculation with STS; completion HEAD-verifies key, size, and ETag before metadata persistence.
- `src/server/db/schema/business.ts:44-106,108-165` — versions have no lifecycle status; `file_metadata` is live-unique by `(path, sha256, size)` and `version_files` is a join table keyed by `(version_id, file_metadata_id)`.
- `src/server/db/repositories/uploads.server.ts:86-214` — completion is idempotent, deadlock-aware, and transactional, and its repository pattern should be reused for draft association.
- `src/shared/api/versions.ts:39-67`, `src/features/versions/api.ts:68-100`, `src/server/api/modules/versions.ts:59-143` — version create/update currently transports the complete `fileIds` array.
- `src/server/db/repositories/versions.server.ts:496-554,722-807` — create/update validates the entire ID set, replaces relations, and writes full before/after file-ID arrays to audit JSON in one transaction.
- `src/server/db/repositories/versions.server.ts:366-388,664-720` — latest means highest active live semantic version and activating one version does not deactivate others; the new lifecycle is independent of `isActive`.
- `src/server/db/repositories/public-releases.server.ts:68-173` and `src/server/domain/public-releases.server.ts:43-99` — public v1 joins the complete manifest, enforces a total cap, and signs every file URL concurrently before returning one response.
- `src/server/db/schema/security.ts:19-55`, `src/server/db/repositories/audit.server.ts:90-95,137-154` — audit before/after values are unrestricted JSONB and currently have no size guard; new batch audits must contain summaries, not file lists.
- `src/features/monitoring/audit-detail-dialog.tsx:27-29,160-193` — the audit UI renders generic JSON and does not require full file-ID arrays.
- `package.json:20-40` — canonical verification commands are `pnpm test`, `pnpm test:db`, `pnpm typecheck`, `pnpm check`, `pnpm build`, `pnpm test:e2e`, and Drizzle generation/check commands.
- [Aliyun OSS Browser.js initialization](https://help.aliyun.com/en/oss/developer-reference/initialization) — the installed `ali-oss` line supports `refreshSTSToken` and `refreshSTSTokenInterval` for long-running browser uploads; the callback must return refreshed temporary credentials.

## Requirements and Assumptions
- Requirement: there is no product-level maximum number of files in a folder/version. Physical browser, PostgreSQL integer, storage, and execution-time limits still exist, but no code should reject a release solely because its total count crosses a configured constant.
- Requirement: every wire batch remains bounded. Defaults: draft resolve 100 metadata items, upload completion 25 items, admin/public listing 200 items, public page maximum 500, and signed download-URL request maximum 100 items. These are per-request limits, not total-release limits.
- Requirement: “same file” means normalized relative path + lowercase SHA-256 + exact byte size. MIME type is presentation metadata and does not force a second upload; when reusing an existing metadata row, the stored canonical MIME type wins.
- Requirement: reuse is program-scoped and may use any prior finalized, non-deleted version of the same program, not only the immediately preceding version.
- Requirement: a reusable candidate must come from a prior finalized, non-deleted version and a live metadata row with a stored non-null ETag originally admitted through successful upload-completion verification. Resolve trusts that durable record and performs no OSS HEAD. A legacy or otherwise unverified row without an ETag is upload-required. This relies on the existing no-overwrite/no-completed-object-deletion storage invariant; object-loss detection belongs to operational integrity monitoring rather than the latency-sensitive create-version path.
- Requirement: changed content at the same path produces a different SHA-keyed OSS object and must upload. Removed files are simply absent from the new self-contained draft.
- Requirement: if every file is reusable, the browser never calls the STS credential endpoint.
- Requirement: finalized versions are immutable with respect to files. This makes cursor traversal stable and prevents partial public manifests during edits.
- Assumption / default applied: draft creation reserves the semantic version number immediately using the existing live-version uniqueness rule. An abandoned draft must be resumed or explicitly deleted before that number can be reused.
- Assumption / default applied: the administrator is trusted to select the intended folder. The backend proves expected count, unique paths, canonical keys, and object existence; it does not receive or retain an unbounded client manifest solely to prove selection intent.
- Assumption / default applied: no scheduled draft cleanup is introduced initially. Draft deletion removes draft associations but leaves file metadata and OSS objects intact.
- Assumption / default applied: public v2 adoption will be coordinated with the current updater client before activating releases that cannot be represented safely by v1.

## Approaches Considered
| Option | Summary | Pros | Cons | Risk | Verdict |
| --- | --- | --- | --- | --- | --- |
| A — Draft version + bounded append/finalize + cursor manifest | Persist a draft version, incrementally associate reusable/completed files, atomically finalize, paginate public metadata, and sign only changed-file URLs. | Truly removes total caps; resumable; incremental upload/download; bounded backend work; atomic public visibility. | Schema/API/UI/public-client changes; coordinated rollout required. | Medium cross-module blast radius; manageable with additive public v2 and staged rollout. | **Chosen by user.** |
| B — Minimal STS decoupling | Remove UI constants, reuse STS, but retain one complete `fileIds` request and one complete public manifest. | Smallest patch; fastest initial implementation. | Merely moves the ceiling to Netlify payloads, SQL parameters, audit JSON, memory, and response size; not actually unlimited. | High production failure risk as release size grows. | Rejected because it does not satisfy the goal. |
| C — Persistent upload-session aggregate | Add a separate upload-session table/state machine and optionally a per-session OSS prefix. | Strongest lifecycle telemetry and explicit session cleanup. | Duplicates version identity, more migrations/state transitions, harder recovery reconciliation, no current need for per-session isolation. | High complexity and maintenance cost. | Rejected as unnecessary for the current single-tenant administrator workflow. |
| D — Synchronous HEAD for every reusable candidate | Revalidate each historical object during every new draft resolve. | Detects manual/lifecycle object loss immediately. | Makes unchanged 1,000+ file releases depend on 1,000+ remote OSS calls, exposes Netlify to gateway inactivity timeouts, and turns provider availability into a version-creation prerequisite. | High latency and failure amplification at scale. | Rejected by user feedback; finalized verified metadata is authoritative during resolve. |

## Proposed Architecture
- **Draft version is the durable workflow owner.** Extend `versions` with `lifecycleStatus = draft | finalized`, `expectedFileCount`, and `finalizedAt`. Existing rows migrate to finalized. `isActive` stays separate and is forbidden for drafts.
- **The draft contains the full target state, not a delta chain.** Every selected file is resolved or uploaded and associated with the draft. Reused files reference existing `file_metadata` rows and OSS objects; changed/new files create or replay metadata after direct upload.
- **Credential issuance is file-agnostic.** `POST /api/v1/uploads/credentials` accepts no file list and returns bucket, region, normalized upload prefix, temporary keys, and expiration. It does not calculate targets.
- **Canonical object-key calculation becomes shared browser/server code.** Move the pure helper from `src/server/integrations/oss/object-key.ts:33-61` to `src/shared/uploads/object-key.ts`; server completion recomputes and rejects mismatches exactly as today.
- **One credential manager per active workflow.** It caches credentials in memory, exposes an expiration-aware single-flight refresh function, and is shared by all per-file OSS clients. `refreshSTSToken` calls the manager; repeated SDK callbacks return the cached credentials until less than 60 seconds remain, so only one backend STS request occurs per validity window.
- **Incremental resolve is an authenticated database mutation.** `POST /api/v1/programs/:programId/versions/:versionId/files/resolve` accepts at most 100 normalized metadata items. It locks/validates the draft, finds same-program finalized candidates whose live metadata was already verified at upload completion, associates them idempotently without calling OSS, and returns per-path `alreadyAssociated`, `reused`, or `uploadRequired`.
- **Upload completion is draft-scoped.** `POST .../:versionId/files/complete` accepts at most 25 uploaded metadata proofs, performs the existing canonical HEAD verification, idempotently persists metadata, and associates it with the still-draft version in the same transaction. Append operations commute and lock the draft row; they do not carry the complete association list.
- **Finalization is atomic.** `POST .../:versionId/finalize` locks the draft, verifies that associated count equals `expectedFileCount`, verifies one unique canonical path per association, rejects any incomplete/conflicting draft, sets `lifecycleStatus=finalized`, `finalizedAt=now`, and increments the version ETag/row version. Activation remains a separate existing operation.
- **Finalized file membership is immutable.** Version metadata edits may retain existing supported fields, but the API no longer accepts `fileIds` replacement for finalized versions. A different folder creates a new semantic version.
- **Admin detail is paginated.** Replace unbounded `fileIds` in normal version detail with `fileCount`, `expectedFileCount`, `lifecycleStatus`, and `finalizedAt`; provide a cursor-paginated admin file endpoint for draft recovery and inspection.
- **Public v2 separates manifest metadata from download signing.** Release header endpoints return metadata and `fileCount`; a path-cursor endpoint returns bounded checksum pages without signed URLs; a bounded download-URL endpoint signs only the files the updater determined are changed. This also enables incremental client download without signing unchanged files.
- **Public visibility filters on finalized + active + live.** Current latest-version semantics and support for multiple active versions remain unchanged; drafts can never be activated or selected publicly.
- **Audit events are summaries.** Draft create/finalize and file resolve/complete events store version ID, counts, and result summaries, never complete file arrays or temporary credentials.

## Detailed Design
### Draft version lifecycle
- Responsibility: reserve version identity, own incremental associations, provide resumable progress, and atomically become a normal release.
- States:
  - `draft`: never public, always `isActive=false`, file association append allowed, metadata fields editable, explicit delete/resume allowed.
  - `finalized`: association append/remove rejected, activation and existing safe metadata operations allowed, eligible for public selection only when active.
- Create contract: `POST /api/v1/programs/:programId/versions/drafts` with `{ versionNumber, description, expectedFileCount }`; response includes draft ID, ETag, lifecycle, associated count zero, and expected count.
- Finalize contract: `POST /api/v1/programs/:programId/versions/:versionId/finalize` with `X-Updater-If-Match`; no full file array. A stale metadata ETag, incomplete count, duplicate path, non-draft state, or deleted program/version fails without partial finalization.
- Resume: the UI loads draft counts, asks the administrator to reselect the intended full folder, rehashes locally, and calls resolve. Already-associated identities return `alreadyAssociated`; no file bodies or STS secrets are persisted.
- Changing the intended folder after associations exist is not an in-place reset. The UI requires deleting the draft and starting a new draft, preventing accidental stale associations.

### Incremental resolve and upload
- Input item: `{ path, sha256, size, mimeType }`, where path is canonicalized, SHA-256 and size define content identity, and MIME is advisory.
- Resolve lookup order:
  1. Check the same draft for an existing association with the same path/SHA/size; return `alreadyAssociated`.
  2. Reject a same-draft same-path association with a different SHA/size as `PATH_CONFLICT`; the administrator must restart the draft.
  3. Find a matching `file_metadata` row associated with any finalized live version of the same program.
  4. Treat the finalized candidate's stored path/SHA/size/object key/non-null ETag as authoritative; rows without an ETag are upload-required. Do not initialize the OSS metadata client or issue HEAD from resolve.
  5. Lock the draft and insert the association with `ON CONFLICT DO NOTHING`; return `reused` and canonical stored metadata.
  6. If no eligible candidate exists, return `uploadRequired`.
- New/changed files use the shared deterministic key and direct multipart upload. Completion reuses existing HEAD and persistence semantics, then associates in the draft transaction.
- File bodies remain outside Netlify. Metadata batches may run with bounded client concurrency; draft-row locking serializes only the short database association transaction, not hashing or upload work.
- All-resolved folders skip credential acquisition. Mixed folders acquire credentials immediately before the first `uploadRequired` item.

### Credential manager and long-running multipart uploads
- `UploadCredentialsRequest` becomes an empty authenticated request; `UploadCredentialsResponse` becomes `{ bucket, region, uploadPrefix, credentials }` and removes `objects`.
- The browser computes object keys from shared canonical code. Returning the prefix adds no permission beyond the current prefix-wide STS policy and does not expose permanent secrets.
- One `UploadCredentialManager` is created per upload workflow. It keeps only in-memory credentials and a single in-flight refresh promise.
- `getCredentials()` returns cached credentials when expiration is more than 60 seconds away; otherwise it performs one backend request shared by all waiting files.
- Every per-file `ali-oss` client receives current keys plus `refreshSTSToken`. SDK refresh callbacks call the same manager, so simultaneous multipart uploads cannot stampede STS.
- If refresh fails, affected items enter a recoverable credential/upload failure state while preserving multipart checkpoints. Retry reacquires credentials and resumes; no new draft or metadata row is created.
- The existing 900-second STS duration may remain. The manager, rather than file-count batches, determines refresh frequency. Credential issuance rate limiting remains request-based and is expected to see roughly one request per active 15-minute window.

### Draft association repository and concurrency
- Add repository operations conceptually equivalent to `resolveDraftFiles`, `completeDraftFiles`, `finalizeDraft`, and `listVersionFiles`.
- Every association mutation locks the addressed version row, rejects non-draft/deleted versions, and inserts only version/file relationships; it never replaces the full set.
- Existing `(version_id, file_metadata_id)` primary key makes exact replays idempotent. Same-path/different-content conflicts are checked while the version row lock is held, and finalization repeats a unique-path invariant check.
- Resolve performs no external provider call. Its transaction rechecks draft lifecycle before association. If finalization won the race, association returns `VERSION_FINALIZED`; it never mutates the finalized manifest.
- File metadata and association persistence for uploaded files occur in one database transaction after HEAD verification. Reused candidates use the existing metadata row and insert only the relation.
- Audit records contain `{ requestedCount, alreadyAssociatedCount, reusedCount, uploadRequiredCount, newlyAssociatedCount, totalAssociatedCount }` or finalize counts. Paths, file IDs, keys, credentials, and full manifests are excluded.

### Version and schema changes
- Add `versions.lifecycle_status` as constrained text (`draft`, `finalized`), `versions.expected_file_count` as nullable/non-negative database integer for migrated finalized rows and required positive value for new drafts, and `versions.finalized_at` as nullable timestamp.
- Migration sequence: add nullable columns; backfill every existing live/deleted version to `finalized`, set `finalized_at=created_at`, leave migrated expected count nullable; then add defaults/check constraints so new drafts default to inactive and cannot have `finalized_at`, while finalized rows require it.
- Add a check preventing `is_active=true` when lifecycle is draft. Update active/latest indexes and queries to include finalized status.
- Keep `version_files` normalized rather than copying path into the join table. All draft association writers lock the version and check path uniqueness; finalization verifies it again.
- Version list/detail DTOs expose counts/lifecycle instead of an unbounded `fileIds` array. Admin file inspection uses keyset pagination ordered by normalized path.
- Existing finalized rows and their relations require no backfill beyond lifecycle/finalized time. No OSS or file-metadata migration occurs.

### Public release v2 and incremental client downloads
- Additive endpoints:
  - `GET /api/public/v2/programs/:programId/releases/latest` → release header with program/version metadata, finalized/published time, and total file count.
  - `GET /api/public/v2/programs/:programId/releases/:versionNumber` → the same header for an explicit finalized active version.
  - `GET .../releases/:versionNumber/files?cursor=<lastPath>&pageSize=200` → ordered file metadata page containing path, SHA-256, size, MIME, checksum algorithm, and next cursor; no download URLs.
  - `POST .../releases/:versionNumber/download-urls` with at most 100 `{ path, sha256 }` entries → 300-second signed URLs only for exact currently associated entries.
- The cursor is an opaque base64url representation of the last canonical path. Paths are public manifest data and unique within a finalized version, so no internal UUID needs to be exposed. Explicit version-number routes keep traversal stable even if “latest” changes between pages.
- The updater fetches metadata pages, compares path/SHA/size with its installed manifest/local state, requests URLs only for added/changed files, downloads them, and removes paths absent from the new complete manifest. This is incremental download while each release remains independently reconstructable.
- Public v1 remains unchanged during migration for current consumers and existing representable releases. The rollout must ship v2-capable clients before an unlimited release is activated. After the supported-client cutoff, v1 may return a documented `UPGRADE_REQUIRED` problem for releases it cannot safely serialize; v2 has no total cap.

### UI behavior
- Folder selection no longer shows a total-count error. It still rejects invalid paths and per-file size/key violations.
- Clicking upload/create first creates or resumes a draft, then hashes the full selected folder. Progress shows total, hashing, reused, upload-required, uploaded, associated, and failed counts.
- Resolve runs before credential acquisition. Reused/already-associated items immediately become complete; only `uploadRequired` items enter OSS upload.
- When all selected items are associated and server count equals expected count, the final action calls finalize and closes the dialog on success.
- Drafts appear in version management with a Draft badge and resume/delete actions. Reselecting the intended folder is required after page refresh because `File` handles are deliberately not persisted.
- Finalized version edit no longer offers file replacement. The UI directs file changes to “Create new version,” preserving immutable release manifests.

## Data and Control Flow
1. Administrator selects a folder. Browser normalizes relative paths and records `expectedFileCount`; no total-cap check runs.
2. Browser creates a draft version, reserving version number and receiving draft ID/ETag.
3. Browser hashes files with the existing bounded workers and sends metadata to draft resolve in batches of 100.
4. Server classifies each item using current-draft associations and prior finalized metadata. Prior-version matches are associated and returned as reused without an OSS call; already-associated items support resume; changed/new items return upload-required.
5. If and only if upload-required items exist, the shared credential manager requests one prefix-scoped STS set.
6. Browser derives canonical object keys and uploads only new/changed files directly to OSS with existing file/multipart concurrency. The OSS SDK consults the shared single-flight credential manager when refresh is needed.
7. Browser sends successful proofs to draft completion in batches of 25. Server recomputes keys, HEAD-verifies, transactionally upserts metadata and associates it with the draft, and returns bounded results.
8. Failed or ambiguous uploads retain current retry/reconcile behavior. Reselecting the folder later repeats resolve and skips everything already associated or reusable.
9. Browser calls finalize with the draft ETag after every selected path is associated. Server locks the draft, verifies expected count and unique paths, flips lifecycle to finalized, and emits a summary audit.
10. A separate existing activation operation may make the finalized version public. Drafts are never selected by public queries.
11. Updater clients fetch v2 release header and manifest pages, compare checksums locally, and request signed URLs only for changed files.

## Data Model and Contracts
- `versions.lifecycle_status`: `draft | finalized`; default for newly created workflow rows is draft; migrated rows are finalized.
- `versions.expected_file_count`: positive count for drafts; nullable for migrated finalized versions. This is a physical database integer, not an application policy ceiling.
- `versions.finalized_at`: null for drafts and set exactly once at finalization; public v2 uses it as release time.
- `version_files`: unchanged join structure. Association append is draft-only and idempotent.
- Same-file identity: canonical `path + sha256 + size`; existing stored MIME/ETag/object key are authoritative on reuse.
- Draft DTO: `{ id, versionNumber, description, lifecycleStatus, expectedFileCount, associatedFileCount, finalizedAt, isActive, isLatest, etag, ...timestamps }`; no full `fileIds`.
- Credential DTO: `{ bucket, region, uploadPrefix, credentials: { accessKeyId, accessKeySecret, securityToken, expiration } }`; no input files and no per-file objects.
- Resolve response item: `{ path, status: alreadyAssociated | reused | uploadRequired, canonicalMimeType? }` in request order.
- Completion response item: existing secret-free metadata identity in request order; request remains bounded to 25.
- Public v2 manifest page: `{ items, nextCursor, pageSize, versionNumber }`; download signing is a separate bounded contract.
- Backward compatibility: administrator frontend/backend change atomically in one deployment; public v2 is additive; public v1 is preserved during client migration.

## Change List
| File | Lines | Action | Notes |
| --- | --- | --- | --- |
| `src/shared/api/uploads.ts` | L1-L113 | modify | Remove total and credential-file caps; make credentials file-agnostic; add bounded resolve/draft-completion contracts. |
| `src/shared/api/versions.ts` | L6-L67 | modify | Remove `VERSION_FILES_MAX_ITEMS` and unbounded `fileIds`; add draft lifecycle/count/finalize DTOs. |
| `src/shared/api/public-releases.ts` | L1-L23 | modify | Add v2 header/page/download contracts while preserving v1. |
| `src/shared/uploads/object-key.ts` | — | add | Browser/server pure canonical key builder moved from server integration. |
| `src/server/integrations/oss/object-key.ts` | L1-L61 | remove/re-export | Preserve temporary import compatibility during migration, then remove server-only ownership. |
| `src/server/db/schema/business.ts` | L44-L106 | modify | Add version lifecycle, expected count, finalized timestamp, checks/indexes. |
| `drizzle/0002_*.sql` and `drizzle/meta/*` | — | add/modify | Backfill existing versions as finalized and add constraints/indexes. |
| `src/server/db/schema/schema.test.ts` | L224-L393 | modify | Assert new columns, defaults, checks, and indexes. |
| `src/server/db/schema/schema.db.test.ts` | L25-L62, L139-L157 | modify | Prove migration/default/check behavior against disposable DB. |
| `src/server/api/modules/uploads.ts` | L50-L150, L318-L385 | modify | Empty credential request; draft resolve/completion transport bounds and rate policies. |
| `src/server/domain/uploads.server.ts` | L268-L303, L449-L645 | modify | Separate STS issuance from targets; retain canonical completion proof; expose reusable helpers to draft service. |
| `src/server/api/plugins/rate-limit.server.ts` | L42-L64 | modify | Replace total-file budget with throughput windows; keep credential request limit. |
| `src/server/db/repositories/draft-version-files.server.ts` | — | add | Candidate lookup, draft locking, idempotent association, counts, unique-path checks. |
| `src/server/domain/draft-version-files.server.ts` | — | add | Database-authoritative resolve classification and bounded upload-completion HEAD orchestration. |
| `src/server/api/modules/draft-version-files.ts` | — | add | Draft resolve, complete, file-page, and finalize routes/contracts. |
| `src/server/db/repositories/versions.server.ts` | L366-L447, L496-L807 | modify | Create drafts, finalize atomically, filter latest/activation by finalized, remove full replacement/audit arrays. |
| `src/server/domain/versions.server.ts` | L211-L243, L404-L540 | modify | Draft lifecycle validation; no total file array or finalized membership mutation. |
| `src/server/api/modules/versions.ts` | L59-L143, L286-L399 | modify | Draft/finalize/detail contracts and ETags. |
| `src/features/versions/credential-manager.client.ts` | — | add | In-memory expiration-aware, single-flight STS cache shared by uploaders. |
| `src/features/versions/oss-uploader.client.ts` | L300-L412 | modify | Use shared object key and `refreshSTSToken` callback without losing per-file cancellation. |
| `src/features/versions/upload-workflow.client.ts` | L37-L44, L421-L693 | modify | Resolve first, skip reused, acquire credentials lazily, complete draft batches, remove authorization target maps. |
| `src/features/versions/folder-picker.tsx` | L62-L91 | modify | Remove total-count rejection only; retain path/per-file validation. |
| `src/features/versions/version-form.tsx` | L133-L165, L224-L245, L465-L569 | modify | Create/resume draft, progress counters, finalize without full file IDs. |
| `src/features/versions/api.ts` | L68-L100 | modify | Draft/resolve/complete/finalize and paginated file API clients. |
| `src/features/versions/version-dialogs.client.tsx` | L340-L355 | modify | Preserve draft on recoverable close/failure; finalize then invalidate/close. |
| `src/features/versions/versions-page.tsx` | L130-L131, L386-L390 | modify | Draft badge, resume/delete actions, immutable finalized-file UX. |
| `src/server/db/repositories/public-releases.server.ts` | L68-L173 | modify | Finalized filter, release header, path-keyset pages, bounded exact-file lookup. |
| `src/server/domain/public-releases.server.ts` | L43-L99 | modify | Stop signing full manifests; sign only requested changed-file batches. |
| `src/server/api/modules/public-releases.ts` | L102-L134 | modify | Add v2 header/files/download routes; retain v1. |
| `src/server/api/app.server.ts` | L133-L210 | modify | Mount new authenticated draft and anonymous v2 modules. |
| `src/routes/api/public/v2/$.ts` | — | add | Same-origin public v2 forwarding route. |
| `src/lib/i18n/catalogs.ts` | version upload keys | modify | Remove total-count messages; add draft/reuse/resume/finalize states. |
| `README.md` and `AGENTS.md` | upload/public decisions | modify | Replace stale 256/5,000 claims and record lifecycle/compatibility/rollout. |

## Error Handling and Edge Cases
- Empty folder → reject before draft creation with `FILES_REQUIRED`.
- Invalid/duplicate normalized path in selection → reject locally and again in resolve; no draft association occurs.
- Same path appears in a draft with different SHA/size → `DRAFT_PATH_CONFLICT`; require delete/restart rather than silently replacing.
- Prior finalized metadata exists → reuse it without synchronous OSS access. Unexpected completed-object loss violates the storage invariant and is surfaced by operational integrity checks/download failure rather than making every draft resolve provider-dependent.
- Stored MIME differs from current browser MIME for the same path/SHA/size → reuse stored canonical MIME; no redundant upload.
- All files reusable → associate/finalize with zero STS calls and zero PUTs.
- Credential expires during long multipart work → `ali-oss` refresh callback obtains one shared replacement; if refresh fails, item becomes retryable with checkpoint retained.
- Multiple upload clients request refresh together → credential manager single-flight yields one backend AssumeRole call.
- Duplicate resolve/complete request → idempotent status/results; no duplicate relation, metadata, or full-array audit.
- Resolve/complete races finalization → version-row lock decides order; after finalized, late association returns `VERSION_FINALIZED` and cannot mutate manifest.
- Finalize count lower or higher than expected → `DRAFT_INCOMPLETE` or `DRAFT_FILE_COUNT_CONFLICT`; lifecycle remains draft.
- Finalize finds duplicate canonical paths → `DRAFT_PATH_CONFLICT`; lifecycle remains draft.
- Page refresh/dialog close → no secrets/checkpoints survive; draft survives. Reselecting the intended folder rehashes and skips already-associated/reusable items.
- Draft semantic version blocks another administrator → existing uniqueness conflict identifies the resumable draft; do not create a second draft.
- Draft delete → soft-delete draft, remove its join rows, retain metadata/OSS objects, audit summary only.
- Public “latest” changes between pages → client resolves latest header once, then traverses explicit version-number pages.
- Public cursor malformed → 400 problem without database identifiers or stack details.
- Requested signed download path/hash is absent from the finalized active version → per-item not-found or whole 404 contract, with no URL minted.
- Legacy v1 requests an oversized post-migration release → documented `UPGRADE_REQUIRED`, never truncate the manifest silently.

## Risks and Mitigations
| Risk | Impact | Mitigation | Verification |
| --- | --- | --- | --- |
| Draft schema/activation regression | Draft becomes publicly visible or existing versions disappear | Backfill existing rows finalized; DB check prevents active draft; every latest/public query explicitly filters finalized. | Schema DB tests plus public latest tests with mixed draft/finalized rows. |
| Reuse points at an object deleted outside application policy | Finalized and future releases contain an unusable file | Preserve bucket no-overwrite/no-completed-object-deletion rules; keep completion HEAD proof authoritative; monitor object integrity out of band and alert on signed-download failure. Do not put full-manifest HEAD scans back into interactive resolve. | Domain test proves resolve performs zero OSS calls; operational bucket-policy and download smoke checks remain release gates. |
| Credential refresh stampede | STS throttling and failed uploads | One workflow credential manager with cached expiration and single-flight refresh; SDK callbacks reuse it. | Concurrent refresh unit test asserting one network call. |
| Very large full-array work remains accidentally | Netlify/SQL/audit memory failure | Remove `fileIds` from normal mutation/detail contracts; batch every metadata/association/public operation; scan for removed constants/contracts. | Contract tests, source scan, synthetic 10,001-item workflow test. |
| Concurrent association/finalization race | Partial or mutated finalized manifest | Version-row lock, draft-state recheck, append-only relations, finalize count/path invariant. | Transactional DB race tests. |
| Public v2 client migration gap | Older updater cannot consume large release | Add v2 first, ship compatible client, validate adoption, then activate uncapped release; keep v1 during bridge. | Production canary against both v1 and v2 before activation. |
| Paginated manifest changes during traversal | Duplicate/missing files | Finalized memberships immutable; traverse explicit version; unique path cursor. | Page-boundary tests with insert attempts rejected after finalize. |
| Incremental comparison misclassifies changed file | Client skips required upload/download | Match path + SHA-256 + size, never filename/mtime alone; changed SHA forces new key. | Mixed unchanged/changed/added/removed fixture. |
| Browser memory pressure from many `File` objects | UI stalls before backend | Keep current bounded hash/upload workers; avoid duplicate metadata arrays/maps where possible; virtualize progress list if profiling shows need. | Browser performance acceptance with a generated large folder and heap/timing capture. |
| Audit JSON growth | Monitoring/database bloat | Store batch/finalize summaries only; never full file IDs/paths. | Audit repository/API/UI tests asserting secret-free bounded shapes. |

## Rollout, Migration, and Compatibility
- Phase 1: deploy schema migration and backend contracts with all existing versions backfilled finalized; keep current public v1 and current UI operational until the same application deploy switches the admin workflow.
- Phase 2: enable draft upload UI and public v2 endpoints behind no separate product flag unless rollback safety requires one. Existing finalized releases remain unchanged.
- Phase 3: update and deploy the updater client to consume v2 paginated metadata and request URLs only for changed files. Use a representable bridge release if an older client must update itself before large releases are activated.
- Phase 4: run production browser/OSS acceptance with one all-reused draft and one mixed changed draft, then permit an uncapped release to activate.
- Rollback before any new draft finalization: revert application code; new nullable lifecycle columns are harmless and existing rows remain finalized.
- Rollback after draft creation but before finalization: drafts remain inactive and invisible; resume or delete after restoring the new code.
- Rollback after an unlimited version is activated: do not route it through v1. Deactivate it or retain v2-capable client/backend until the version is superseded; never truncate files.
- No file metadata or OSS backfill is required. Existing deterministic object keys are directly reusable.
- Update `README.md` stale 256-file statement and durable `AGENTS.md` architecture notes in the same implementation series.

## Verification Plan
- Acceptance: selecting more than 5,000 files creates no total-count validation error; there is no `MAX_UPLOAD_FILES` or `VERSION_FILES_MAX_ITEMS` product ceiling in executable contracts.
- Acceptance: a synthetic 10,001-file metadata workflow uses bounded resolve/completion calls and never sends the full set in one request.
- Acceptance: a 1,001-file all-new workflow performs one initial STS request when completed within the credential window, not `[1000,1]` STS requests.
- Acceptance: concurrent SDK refresh requests near expiration cause exactly one backend credential request and all waiting uploads receive the refreshed keys.
- Acceptance: an all-reused folder performs zero PUT operations and zero STS requests; associated count reaches expected count and finalization succeeds.
- Acceptance: a mixed fixture with unchanged A, changed B, added C, and removed D reuses A, uploads B/C, omits D, and publishes a complete A/B/C manifest.
- Acceptance: resolving an all-reused folder performs zero OSS HEAD, zero STS, and zero PUT calls; the prior completion proof remains the trust anchor.
- Acceptance: refresh/reselect of a partial draft marks prior associations complete and uploads only remaining files.
- Acceptance: finalization rejects incomplete count, duplicate path, stale ETag, and a race with a late completion without exposing a partial public release.
- Acceptance: existing migrated versions remain listable/activatable/public and are classified finalized.
- Acceptance: public v2 path-cursor traversal has no duplicates or omissions across page boundaries and signs only explicitly requested changed files.
- Acceptance: public v1 regression remains unchanged for existing representable releases during migration.
- Unit/component tests: update folder picker, credential manager, upload workflow, version form/dialog/page, shared object-key, API schema, rate-limit, domain, public-release, and audit tests at the existing cited test seams.
- DB tests: run migrations against authorized `TEST_DATABASE_URL`; prove backfill/check constraints, append idempotency, same-path conflict, finalize invariants, lifecycle filters, and concurrent transactions.
- Static/build gates: `pnpm check`, `pnpm typecheck`, `pnpm test`, `pnpm db:check`, `pnpm build`.
- Database gate: `pnpm test:db` only against a disposable migrated branch, never shared production data.
- Browser automation: `pnpm test:e2e` for draft/resume/reuse UI states, plus a real Codex in-app-browser acceptance against a deployed preview using a generated folder fixture, network inspection, and OSS object-count evidence.
- Production acceptance: create version N with fixture A/B/D, then version N+1 with unchanged A, changed B, new C; prove resolve statuses, absence of PUT for A, one STS issuance per validity window, successful finalize, v2 page traversal, and signed downloads for B/C only. Remove test metadata per the authorized cleanup manifest; retain/delete OSS objects only under explicit cleanup authority.
- Observability: audit summaries for draft created, files resolved/completed, finalized/deleted; Sentry captures endpoint, bounded counts, lifecycle/error code, and request ID but never paths, hashes, keys, credentials, or file contents.

## Execution Plan
> Tasks the design breaks down into. Independent tasks within a wave run in
> parallel; implementation + its tests are ONE task. Every task is
> self-sufficient and every acceptance criterion is agent-executable.

### Parallel Waves
```
Wave 1 (foundation, parallel):
├── T1: Shared upload/version/public contracts and canonical object key
└── T2: Draft lifecycle schema and migration
Wave 2 (backend domains, parallel after foundations):
├── T3: File-agnostic STS credential endpoint and rate policy (depends: T1)
├── T4: Draft version, incremental resolve/completion, and finalization backend (depends: T1, T2)
└── T5: Public v2 cursor manifest and selective URL signing (depends: T1, T2)
Wave 3 (integration and client, parallel where disjoint):
├── T6: Incremental/resumable administrator upload UI and credential manager (depends: T1, T3, T4)
└── T7: Server route integration and cross-module API tests (depends: T3, T4, T5)
Wave 4 (acceptance and durable context):
└── T8: Browser E2E, load/regression matrix, documentation, and rollout evidence (depends: T5, T6, T7)
Critical Path: T1 + T2 → T4 → T6 → T8
```

### Dependency Matrix
| Task | Files | Depends on | Blocks |
| --- | --- | --- | --- |
| T1 | shared upload/version/public APIs, shared object-key + tests | — | T3, T4, T5, T6 |
| T2 | schema, migration/meta, schema tests | — | T4, T5 |
| T3 | uploads API/domain/rate-limit + tests | T1 | T6, T7 |
| T4 | versions and new draft-file backend repositories/domains/modules + tests | T1, T2 | T6, T7 |
| T5 | public-release repository/domain/module + tests | T1, T2 | T7, T8 |
| T6 | version upload client/form/dialog/page/i18n + tests | T1, T3, T4 | T8 |
| T7 | app mounting, public v2 route, integration tests | T3, T4, T5 | T8 |
| T8 | E2E spec/fixtures, README, AGENTS, evidence | T5, T6, T7 | — |

### Tasks
#### T1: Shared contracts and canonical key
- **What to do**: remove total-count constants and unbounded `fileIds` contracts; define draft, resolve, completion, v2 page/signing, and file-agnostic credential DTOs; move canonical key construction into shared code; update all shared tests and temporary server re-export.
- **Must NOT do**: do not change server behavior, database schema, or UI in this task; do not expose permanent credentials or database IDs.
- **Files**: `src/shared/api/uploads.ts`, `src/shared/api/uploads.test.ts`, `src/shared/api/versions.ts`, matching version contract test, `src/shared/api/public-releases.ts`, matching public contract test, `src/shared/uploads/object-key.ts`, object-key test, `src/server/integrations/oss/object-key.ts` re-export only.
- **References**: `src/server/integrations/oss/object-key.ts:33-61` — canonical algorithm; `src/shared/api/uploads.ts:45-113` — current DTO conventions.
- **Interface contracts**: exactly the draft/credential/resolve/completion/public v2 shapes in “Data Model and Contracts”; per-request batch constants only.
- **Acceptance criteria** (agent-executable):
  - [ ] Shared tests prove deterministic browser/server keys and no executable total file ceiling; `pnpm check && pnpm typecheck` passes for the task branch.
- **QA scenarios**:
  - Happy path: generate key from Unicode nested path + valid SHA and assert shared/server import parity.
  - Failure/edge: invalid SHA or >1,023-byte object key returns the existing stable validation error.
- **Complexity**: medium.

#### T2: Draft lifecycle schema and migration
- **What to do**: add lifecycle/expected-count/finalized-time columns, backfill existing versions, add inactive-draft/finalized-time constraints and lifecycle-aware indexes, generate Drizzle migration/meta, and update schema unit/live-DB tests.
- **Must NOT do**: do not modify file metadata/object keys or delete version relations; do not require expected count for migrated finalized rows.
- **Files**: `src/server/db/schema/business.ts`, `src/server/db/schema/schema.test.ts`, `src/server/db/schema/schema.db.test.ts`, `drizzle/0002_*.sql`, `drizzle/meta/_journal.json`, generated snapshot.
- **References**: `src/server/db/schema/business.ts:44-106` — existing versions schema; `drizzle/0001_blushing_giant_man.sql:1-2` and `drizzle/meta/_journal.json:1-20` — migration pattern.
- **Interface contracts**: lifecycle is `draft | finalized`; draft implies inactive and null finalized time; finalized requires finalized time.
- **Acceptance criteria** (agent-executable):
  - [ ] `pnpm db:generate`, `pnpm db:check`, schema tests, and authorized `pnpm test:db` prove migration/backfill/constraints.
- **QA scenarios**:
  - Happy path: migrate an existing active version and verify finalized/active/public eligibility is preserved.
  - Failure/edge: direct insert/update of an active draft fails the DB check.
- **Complexity**: medium.

#### T3: File-agnostic STS credential endpoint
- **What to do**: remove per-file target generation from credential issuance, return normalized upload prefix, preserve prefix-wide policy, adjust audit to one secret-free issuance summary, and replace total-token limits with request/throughput policies; update domain/API/STS/rate tests.
- **Must NOT do**: do not cache temporary credentials server-side, weaken the prefix policy, add GetObject to browser STS, or log secrets.
- **Files**: `src/server/api/modules/uploads.ts`, `src/server/domain/uploads.server.ts`, `src/server/api/plugins/rate-limit.server.ts`, their tests, and STS tests only if expected response shape changes.
- **References**: `src/server/integrations/oss/sts.server.ts:162-185,242-298` — policy and AssumeRole; `src/server/domain/uploads.server.ts:610-645` — current coupling to remove.
- **Interface contracts**: empty credentials request; response includes one prefix-wide temporary credential set and no object list.
- **Acceptance criteria** (agent-executable):
  - [ ] API/domain tests prove zero file metadata is accepted/returned, policy remains prefix-scoped, and no credential value appears in audit/error serialization.
- **QA scenarios**:
  - Happy path: one authenticated request returns bucket/region/prefix/expiration.
  - Failure/edge: STS provider failure maps to existing secret-free unavailable problem and consumes no per-file budget.
- **Complexity**: medium.

#### T4: Draft lifecycle and incremental association backend
- **What to do**: add draft creation/finalization, program-scoped database-authoritative candidate resolution, bounded uploaded-object completion verification + association transaction, paginated admin file listing, lifecycle-aware latest/activation, immutable finalized membership, summary audits, and repository/domain/API/DB tests.
- **Must NOT do**: do not call OSS inside a database transaction; do not accept a full `fileIds` replacement; do not reuse candidates from drafts/deleted versions/other programs; do not expose object keys.
- **Files**: `src/server/db/repositories/draft-version-files.server.ts`, `src/server/domain/draft-version-files.server.ts`, `src/server/api/modules/draft-version-files.ts`, tests; `src/server/db/repositories/versions.server.ts`, `src/server/domain/versions.server.ts`, `src/server/api/modules/versions.ts`, their tests.
- **References**: `src/server/db/repositories/uploads.server.ts:86-214` — idempotent/transactional pattern; `src/server/domain/uploads.server.ts:449-608` — HEAD proof; `src/server/db/repositories/versions.server.ts:496-554,722-807` — current transaction/audit behavior to replace.
- **Interface contracts**: resolve max 100; complete max 25; append operations draft-only/idempotent; finalize uses ETag and expected count; finalized file membership immutable.
- **Acceptance criteria** (agent-executable):
  - [ ] Unit/DB tests prove all-reused resolve makes zero OSS calls, mixed/new upload completion remains HEAD-verified, replay, path conflict, incomplete finalize, concurrency race, migrated finalized behavior, and summary-only audit.
- **QA scenarios**:
  - Happy path: version N+1 reuses unchanged A, uploads changed B/new C, finalizes exactly three associations.
  - Failure/edge: OSS metadata provider is unavailable while every item is reusable; resolve still succeeds from finalized metadata and completion verification behavior remains unchanged for newly uploaded items.
- **Complexity**: high.

#### T5: Public v2 cursor manifest and selective signing
- **What to do**: filter on finalized/active/live versions, implement release headers, path-keyset metadata pages, bounded exact path/SHA download signing, stable cursors, v1 compatibility/error behavior, and repository/domain/API tests.
- **Must NOT do**: do not sign every file during metadata traversal, expose DB IDs/object keys/ETags, silently truncate v1, or select drafts.
- **Files**: `src/server/db/repositories/public-releases.server.ts`, `src/server/domain/public-releases.server.ts`, `src/server/api/modules/public-releases.ts`, and their tests.
- **References**: `src/server/db/repositories/public-releases.server.ts:68-173` — current selection/join; `src/server/domain/public-releases.server.ts:43-99` — signing concurrency to narrow.
- **Interface contracts**: header + page + download URL contracts from T1; page order is canonical path; explicit version traversal is immutable.
- **Acceptance criteria** (agent-executable):
  - [ ] Tests traverse more than two pages without duplicate/missing items, reject draft/inactive rows, and prove only requested paths are signed.
- **QA scenarios**:
  - Happy path: latest header resolves version, three metadata pages traverse, two changed paths receive valid URLs.
  - Failure/edge: cursor/path/hash tampering yields bounded 400/404 without internal identifiers.
- **Complexity**: high.

#### T6: Incremental/resumable administrator upload UI
- **What to do**: add single-flight credential manager, wire SDK refresh callback, resolve before upload, skip reused/already-associated items, lazily acquire STS, create/resume/finalize drafts, remove total-count UI, expose progress counters/draft actions, and update all component/workflow/API/i18n tests.
- **Must NOT do**: do not persist `File`, checkpoint, or credentials; do not acquire STS when no upload is required; do not let finalized versions replace files.
- **Files**: `src/features/versions/credential-manager.client.ts` + test, `oss-uploader.client.ts` + test, `upload-workflow.client.ts` + test, `folder-picker.tsx` + test, `version-form.tsx` + test, `api.ts` + test, `version-dialogs.client.tsx` + test, `versions-page.tsx` + test, `src/lib/i18n/catalogs.ts`.
- **References**: `src/features/versions/upload-workflow.client.ts:236-245,421-477,578-693` — current authorization/completion flow; `src/features/versions/oss-uploader.client.ts:347-412` — per-file SDK setup; official Aliyun refresh documentation cited above.
- **Interface contracts**: one manager per workflow; 60-second minimum validity; refresh is single-flight; resolve statuses map deterministically to queue states.
- **Acceptance criteria** (agent-executable):
  - [ ] Component/workflow tests prove 1,001 new files use one valid-window STS request, 10,001 metadata items stay batched, all-reused uses zero STS/PUT, mixed/resume works, and concurrent refresh makes one request.
- **QA scenarios**:
  - Happy path: reselect a partial draft folder; UI marks previous/reused entries complete and uploads only changed/missing entries.
  - Failure/edge: STS refresh fails mid-multipart; UI retains checkpoint, exposes retry, and does not finalize incomplete draft.
- **Complexity**: high.

#### T7: Server integration and route forwarding
- **What to do**: mount draft modules and public v2 in the Elysia app, add TanStack Start v2 forwarding route, update CORS/rate-route matching as required, and add cross-module app contract tests.
- **Must NOT do**: do not weaken administrator auth or public exact-origin rules; do not change Better Auth routes.
- **Files**: `src/server/api/app.server.ts`, `src/server/api/app.test.ts`, `src/routes/api/public/v2/$.ts`, public API plugin tests if route matching changes.
- **References**: `src/server/api/app.server.ts:133-210` — current authenticated/public module boundary; `src/routes/api/public/v1/$.ts:1-10` — forwarding pattern.
- **Interface contracts**: draft routes authenticated/no-store; public v2 anonymous with existing exact-origin policy and bounded IP limits.
- **Acceptance criteria** (agent-executable):
  - [ ] App tests prove auth/CORS/cache headers and route reachability; `pnpm typecheck` and `pnpm build` pass with generated route tree.
- **QA scenarios**:
  - Happy path: authenticated draft routes and allowed-origin public v2 requests reach their modules.
  - Failure/edge: anonymous draft mutation is 401 and disallowed public origin is 403.
- **Complexity**: medium.

#### T8: Acceptance, documentation, and rollout evidence
- **What to do**: add browser fixtures/specs and synthetic scale regression, run the complete static/DB/build/browser matrix, perform authorized preview OSS acceptance, update README/AGENTS/design evidence with exact results and public-client rollout gate.
- **Must NOT do**: do not claim live OSS, database, Sentry, browser, or production success without direct evidence; do not deploy production or mutate production data without explicit authorization.
- **Files**: new/isolated `tests/e2e/version-incremental-upload.spec.ts`, fixture generator under `tests/fixtures` or scripts, `README.md`, `AGENTS.md`, existing evidence documents only.
- **References**: `package.json:20-40` — verification commands; current E2E conventions in `tests/e2e`.
- **Interface contracts**: no new runtime contracts; tests consume T1/T4/T5/T6/T7 contracts unchanged.
- **Acceptance criteria** (agent-executable):
  - [ ] `pnpm check`, `pnpm typecheck`, `pnpm test`, `pnpm db:check`, authorized `pnpm test:db`, `pnpm build`, `pnpm test:e2e`, preview in-app-browser acceptance, and OSS network/object evidence all pass or are explicitly reported as gated.
- **QA scenarios**:
  - Happy path: two-version A/B/D → A/B'/C scenario proves unchanged A produces no PUT and public v2 downloads only B'/C.
  - Failure/edge: make OSS metadata HEAD unavailable; an all-reused resolve still completes without provider access, while a new upload completion fails safely and remains retryable.
- **Complexity**: high.

## Open Questions
- None blocking. Batch sizes are operational constants and may be tuned after measurement without reintroducing a total-release ceiling.
- Public v2 requires a coordinated updater-client implementation before the first release that cannot be consumed safely by v1; that is a rollout dependency, not a design ambiguity.

## Handoff
- Recommended next stage: adversarial technical review, then implementation using the eight tasks/four waves above.
- Highest-risk review areas: lifecycle migration/rollback, draft association concurrency, ali-oss refresh behavior, public v1→v2 client rollout, and the distinction between reusable metadata and verified OSS presence.
- Files likely to change are enumerated in the Change List; database, upload backend, public API, and frontend work can proceed in the planned dependency waves.

## Change Log

### Rev 1 — 2026-08-07
**Feedback source:** user feedback
| Feedback | Disposition | Section | Reason |
| --- | --- | --- | --- |
| Per-candidate OSS HEAD makes large all-reused versions slow and susceptible to 502/504; reuse should trust previously verified metadata. | adopt | Goals; Requirements and Assumptions; Approaches Considered; Proposed Architecture; Incremental resolve and upload; Draft association repository and concurrency; Data and Control Flow; Error Handling and Edge Cases; Risks and Mitigations; Verification Plan; T4/T8 | Current implementation evidence at `src/server/domain/draft-version-files.server.ts:461-495` shows every reusable candidate performs `headObject`, while `src/server/db/repositories/draft-version-files.server.ts:743-778` already limits candidates to live metadata attached to finalized versions of the same program. Upload completion remains independently HEAD-verified at `src/server/domain/draft-version-files.server.ts:380-452`. Removing synchronous reuse HEAD eliminates the remote-call multiplier without weakening admission of newly uploaded objects. |
