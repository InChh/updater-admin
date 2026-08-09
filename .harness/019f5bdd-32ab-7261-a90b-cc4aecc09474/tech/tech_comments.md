# Technical Design Review Report

## Review Summary
- **Review target**: `.harness/019f5bdd-32ab-7261-a90b-cc4aecc09474/tech/tech.md`
- **Conclusion**: REVISE
- **Blocker count**: 0
- **Major count**: 5
- **Minor count**: 2

## Status Reason
Within `updater-admin` only, the draft/version architecture is sound, but global reuse is incorrectly restricted and the upload metadata path retains unnecessary OSS ETag, universal HEAD verification, duplicate resolve transactions, and an obsolete completion endpoint.

## Inputs Reviewed
| Artifact | Status | Notes |
| --- | --- | --- |
| `.harness/019f5bdd-32ab-7261-a90b-cc4aecc09474/tech/tech.md` | reviewed | Post-iteration review of Rev 1 and the implemented updater-admin architecture. |
| `.harness/019f5bdd-32ab-7261-a90b-cc4aecc09474/tech/user-intent.md` | reviewed with correction | Line 14's same-program restriction is stale. Caller correction is authoritative: identical canonical path and hash are globally reusable. |
| `.harness/019f5bdd-32ab-7261-a90b-cc4aecc09474/tech/explored.md` | reviewed | Used for original upload, version, persistence, and public backend seams. |
| Previous `.harness/019f5bdd-32ab-7261-a90b-cc4aecc09474/tech/tech_comments.md` | reviewed and replaced | Out-of-scope conclusions were removed. |
| Caller context | reviewed | Scope is strictly `updater-admin`. |

## Pre-commitment Predictions
| Prediction | Why Expected | Actual Finding |
| --- | --- | --- |
| A stale requirement may have created an artificial reuse boundary | Caller explicitly rejected same-program reuse | found: design and repository require same-program finalized-version provenance. |
| A provider response field may have become a business invariant | Rev 1 retained ETag after removing reuse-time HEAD | found: non-null OSS ETag still gates reuse despite not being file identity. |
| Universal verification may remain on the normal success path | Completion inherited old HEAD semantics | found: every successfully uploaded object is HEADed before metadata persistence. |
| A phase split may have survived removal of the work between phases | Rev 1 removed candidate HEAD | found: resolve still uses two transactions and repeats locks/reads. |
| Transitional code may remain after draft completion became authoritative | Admin frontend moved to draft-scoped completion | found: unscoped `/api/v1/uploads/complete` remains mounted without a product caller. |

## Requirement Coverage
| Requirement / Acceptance Criterion | Source | tech.md Location | Status | Notes |
| --- | --- | --- | --- | --- |
| No product-level total file-count cap | caller and `user-intent.md:5,9` | Draft lifecycle; bounded append/finalize; cursor pagination | covered | Bounded batches and draft finalization correctly avoid an unbounded request. |
| Identical canonical path and hash can be reused globally | caller correction | Requirements lines 51-53; resolve steps 3-4 | missing / contradicted | Design adds program, finalized-version and OSS ETag conditions that the caller did not require. |
| One prefix-scoped STS set per validity window | `user-intent.md:10-12` | Credential manager | covered | Single-flight in-memory STS refresh is proportionate and should remain. |
| Direct browser-to-OSS bodies with bounded backend metadata work | `user-intent.md:12-13` | Completion and resolve batches | partial | Batching is correct; universal HEAD and duplicated resolve transactions are unnecessary work. |
| Every finalized version is a self-contained manifest | `user-intent.md:15` | Draft lifecycle and finalization | covered | Necessary and not over-designed. |
| Preserve canonical paths, SHA-256, size, key validation, idempotency and optimistic concurrency | `user-intent.md:16` | Shared key; completion; finalization entity ETag | covered | HTTP entity ETag/row version remains justified; OSS object ETag does not. |
| Anonymous public backend endpoints are bounded | `user-intent.md:16,25` | Public v2 cursor pages and selective signing | covered within updater-admin | Backend v2 separation is proportionate. |
| No legacy UpdaterServer protocol compatibility | `user-intent.md:32` | Non-Goals | partial | The obsolete authenticated admin completion endpoint remains; this is unrelated to public compatibility. |

## Evidence and Code-Grounding Check
| Design Claim | tech.md Location | Evidence Cited | Verification Result | Notes |
| --- | --- | --- | --- | --- |
| Reuse must be same-program, prior-finalized and non-null ETag | Requirements lines 52-53; resolve steps 3-4 | repository reusable query | contradicted by caller | Correct requirement is global canonical path + hash reuse. |
| Stored OSS ETag represents reusable verification | Requirements line 53 | schema `business.ts:131-140`; repository `draft-version-files.server.ts:351-407` | unsupported | ETag is neither SHA-256 identity nor consumed by an integrity process. |
| Upload completion is bounded and verified | Proposed Architecture line 77 | domain `draft-version-files.server.ts:378-457,580-608` | supported but over-broad | Every normal upload success incurs a second OSS request; HEAD still does not verify SHA-256 content. |
| Resolve has no provider call and a short association transaction | Proposed Architecture lines 76,106,122 | domain `:629-660`; repository `:528-620,756-794` | partially contradicted | No provider call is correct, but two transactions repeat program/draft locks and reads. |
| Draft completion is the administrator completion contract | Proposed Architecture line 77 | frontend `versions/api.ts:185-214`; server `uploads.ts:311-363` | partially contradicted | Product frontend uses draft completion, but old unscoped completion remains active. |
| Public v2 keeps server work bounded | Public v2 section | updater-admin repository/domain/API modules | supported | Cursor metadata pages and bounded signing are appropriate server-side. |

## Architecture and Engineering Quality Check
| Area | Status | Notes |
| --- | --- | --- |
| Module boundaries | partial | Draft-scoped file ownership is clear; legacy and draft completion duplicate one responsibility. |
| Interfaces and contracts | partial | Bounded contracts are good; OSS ETag unnecessarily leaks through persistence and completion DTOs. |
| Data/control flow | partial | Draft flow is clear; normal success still takes PUT -> HEAD -> DB and resolve takes two DB transactions. |
| Data model and compatibility | partial | Lifecycle fields and normalized joins are appropriate; global identity is incorrectly filtered by program/finalized provenance. |
| Error handling and recovery | partial | Resume/retry is strong, but reusable existing objects can be reached through avoidable PUT conflict/reconciliation. |
| Security and privacy | pass | Prefix STS, canonical keys, overwrite prohibition, authentication and bounded payloads are proportionate. |
| Performance and operations | fail | Universal completion HEAD, duplicate transactions, and per-batch audit writes amplify large-folder work. |
| Rollout, migration, rollback | pass within updater-admin | Schema migration and additive backend public routes are adequately designed. |
| Trade-off analysis | partial | Reuse-time HEAD was rejected, but normal completion HEAD and the obsolete phase boundary were not reassessed. |
| Verification plan | partial | Missing focused evidence for global cross-program/deleted-draft reuse and selective-HEAD registration. |
| Pragmatic minimalism | fail | Same-program/finalized provenance, OSS ETag, HEAD-all completion, two-phase resolve and duplicate completion are unnecessary. |

## Execution Plan Audit
| Task / Wave | Files / Scope | Dependency Status | Acceptance Mapping | Verdict |
| --- | --- | --- | --- | --- |
| T1/T2 contracts and schema | upload DTOs, metadata, lifecycle | hidden dependency on corrected reuse identity | partial | revise: remove program/finalized/ETag reuse eligibility. |
| T3 credential/key path | STS manager, shared key, OSS uploader | independent | complete | pass: retain single-flight STS and overwrite prohibition. |
| T4 draft association/finalize | draft domain/repository | conflicts with caller correction and Rev 1 simplification | partial | revise: global metadata reuse, selective HEAD, one resolve transaction. |
| T5 public v2 backend | manifest pages and signing | independent within updater-admin | complete | pass: bounded cursor traversal and selective signing are justified. |
| T6 administrator upload UI | workflow/retry/resume | depends on objectEtag success contract | partial | revise: unambiguous OSS success should register without requiring ETag/HEAD. |
| T7 server integration | authenticated route mounting | retains obsolete completion route | partial | revise: remove old unscoped admin completion after consumer check. |
| T8 updater-admin acceptance | unit/DB/build/browser/OSS evidence | missing revised scale cases | partial | revise: add global reuse, selective HEAD, and single-transaction resolve verification. |

## Pre-mortem Failure Scenarios
| Scenario | Covered by Design? | Finding |
| --- | --- | --- |
| Identical path/hash exists under another program | no | M-001: resolve incorrectly returns upload-required and later relies on overwrite conflict. |
| Identical path/hash was uploaded by a draft that was later deleted | no | M-001: retained metadata/object are ignored because no live finalized association remains. |
| A reusable metadata row lacks OSS ETag | no | M-002: valid global identity is rejected for reuse. |
| OSS PUT succeeds but subsequent server HEAD gets transient 502/504 | partial | M-003: a valid upload becomes a registration failure. |
| 10,001 files resolve in 101 batches | partial | M-004: implementation performs twice the required resolve transactions and repeated locks. |
| Legacy and draft completion implementations diverge | no | M-005: validation, error and audit behavior can drift. |
| All files are already globally reusable | partial | M-001/M-002: current provenance/ETag filters can unnecessarily trigger STS/upload. |

## Multi-perspective Notes
- **Executor**: Latest caller feedback must override stale same-program language in `user-intent.md` and `tech.md`.
- **Stakeholder**: Required reuse behavior is simple: canonical path and SHA-256 match globally; program, version lifecycle and OSS ETag must not change the result.
- **Skeptic**: Same-program provenance could be useful in a multi-tenant system, but this project explicitly has no multi-tenancy and already uses global metadata/object keys.
- **Security**: Removing program filtering does not cross a tenant boundary because none exists. Keep canonical key validation, authentication, temporary STS and overwrite prohibition.
- **New-hire**: HTTP entity ETag/row version is optimistic concurrency and must remain; OSS object ETag is the removable field.
- **Ops**: The largest avoidable updater-admin costs are HEAD after every successful upload and two transactions per resolve batch.

## Findings

### Blocker
None.

### Major
- **[M-001] Program/finalized-version provenance contradicts the required global path+hash reuse rule**
  - **Location**: Goals; Requirements lines 51-53; resolve steps 3-4; `user-intent.md:14`.
  - **Problem**: The latest requirement permits global reuse whenever canonical path and file hash match. The design instead requires a live metadata row reachable from a finalized, non-deleted version of the same program.
  - **Evidence**: `src/server/db/repositories/draft-version-files.server.ts:351-407` joins versions and filters application ID, finalized lifecycle, live version and non-null ETag. `file_metadata` identity and deterministic OSS object keys are already global.
  - **Impact**: Cross-program matches and objects uploaded by later-deleted drafts are needlessly classified for upload, then collide with overwrite protection and depend on error reconciliation.
  - **Suggested fix**: Resolve directly against live global `file_metadata` by canonical path + lowercase SHA-256, retaining size as a consistency check. Do not join historical versions or require finalized/live provenance.
  - **Confidence**: HIGH
  - **Realist check**: Global reuse would require stronger isolation in a multi-tenant product, but this project explicitly has no multi-tenancy and the caller confirmed the rule.

- **[M-002] OSS ETag is an unnecessary business field and reuse gate**
  - **Location**: Requirements line 53; resolve step 4; Data Model and Contracts.
  - **Problem**: OSS ETag is not file identity, is not a SHA-256 content proof for multipart objects, and has no updater-admin integrity-monitor consumer.
  - **Evidence**: `src/server/db/schema/business.ts:131-140` stores nullable ETag; `src/server/db/repositories/draft-version-files.server.ts:351-407` requires it; `src/server/domain/draft-version-files.server.ts:402-426` persists the HEAD ETag.
  - **Impact**: Schema, API, queue state and repository logic carry a provider-specific value and reject otherwise valid reusable metadata.
  - **Suggested fix**: Remove OSS ETag from schema, completion DTOs, queue success criteria, repository reconciliation and reuse filters. Keep HTTP entity ETag/row version for optimistic concurrency.
  - **Confidence**: HIGH
  - **Realist check**: Existing populated values mitigate current misses but do not establish a business need.

- **[M-003] Every unambiguously successful upload performs an unnecessary OSS HEAD**
  - **Location**: Proposed Architecture line 77; Data and Control Flow step 7; T4/T6/T8.
  - **Problem**: A successful direct OSS PUT/multipart response is followed by server HEAD before metadata registration, making a second provider request authoritative for normal success.
  - **Evidence**: `src/server/domain/draft-version-files.server.ts:378-457,580-608` HEADs every completion; `src/features/versions/oss-uploader.client.ts:496-527` already receives the successful OSS result and deterministic object key.
  - **Impact**: Transient OSS/Netlify failures can turn completed uploads into user-visible registration failures and add one remote call per new file.
  - **Suggested fix**: Register metadata directly after unambiguous SDK success with server canonical-key validation. Reserve HEAD for ambiguous network results or already-existing objects that lack registered metadata.
  - **Confidence**: HIGH
  - **Realist check**: Selective HEAD preserves uncertain-outcome recovery. Universal HEAD still does not validate content against SHA-256.

- **[M-004] Resolve remains split into two transactions after the external phase was removed**
  - **Location**: Rev 1; resolve lines 98-106; repository/concurrency lines 118-124.
  - **Problem**: `prepareResolve` and `associateResolved` were separated to allow candidate verification, but candidate HEAD is gone while the phase boundary remains.
  - **Evidence**: `src/server/domain/draft-version-files.server.ts:629-660` calls both phases; `src/server/db/repositories/draft-version-files.server.ts:528-620,756-794` starts two transactions and repeats live-program/draft locks and association reads.
  - **Impact**: Every resolve batch pays duplicate database round trips and lock acquisition, increasing latency and contention for large folders.
  - **Suggested fix**: Perform existing-association checks, global reusable metadata lookup, conflict detection, relation inserts, counts and audit in one bounded transaction.
  - **Confidence**: HIGH
  - **Realist check**: The two-phase structure would be justified only if provider work remained between phases; it does not.

- **[M-005] Obsolete unscoped administrator upload completion remains mounted**
  - **Location**: Change List/T7/backward compatibility.
  - **Problem**: The administrator frontend uses draft-scoped completion, but `/api/v1/uploads/complete`, old completion service/repository logic, limiter, audit mapping and tests remain active.
  - **Evidence**: `src/features/versions/api.ts:185-214` exposes draft resolve/complete; `src/server/api/modules/uploads.ts:311-363` and `src/server/api/app.server.ts:315-334` still mount unscoped completion. Non-test updater-admin source search found no caller.
  - **Impact**: Two mutation paths can diverge in validation, errors, limits, auditing and fixes.
  - **Suggested fix**: Keep `/uploads/credentials`; remove `/uploads/complete` and completion-only legacy code after checking for undocumented administrator tooling.
  - **Confidence**: HIGH
  - **Realist check**: If telemetry identifies an external admin tool, deprecate first; none is represented in updater-admin source or requirements.

### Minor
- **[m-001] Per-batch audit events create progress noise and write amplification**
  - **Location**: Proposed Architecture line 83; repository/concurrency line 124.
  - **Problem**: Every resolve/completion batch emits an audit row, so a 10,001-file release can generate hundreds of low-value progress events.
  - **Suggestion**: Audit draft create/delete/finalize/activation and exceptional failures; keep detailed progress in structured logs or coalesced draft counters.

- **[m-002] Operational batch defaults are presented as settled without measurement evidence**
  - **Location**: Requirements line 50; Open Questions line 422.
  - **Problem**: Resolve 100 and completion 25 mix true transport bounds with tuning defaults; completion 25 largely reflects universal HEAD work that should be removed.
  - **Suggestion**: Separate hard validation limits from tunable concurrency/batch defaults and document the measurement used for initial values.

## What's Missing
- The corrected global path+hash reuse rule in the design, repository query, tests and task handoff.
- An explicit admission rule for successful direct OSS uploads, with HEAD reserved for ambiguous outcomes.
- Removal of OSS ETag from updater-admin persistence and contracts.
- A single-transaction resolve design after Rev 1.
- A removal/deprecation task for the old unscoped administrator completion endpoint.
- Comparative updater-admin request-count/latency evidence for the simplified path.

## Ambiguity Risks
- `same file`
  - **Interpretation A**: Global canonical path + SHA-256 match, with size checked for consistency.
  - **Interpretation B**: Same identity only when reachable through a finalized version of the same program.
  - **Risk if wrong**: B recreates unnecessary upload/conflict reconciliation and contradicts caller intent.
- `verified metadata`
  - **Interpretation A**: Metadata admitted after unambiguous OSS success or selective reconciliation.
  - **Interpretation B**: Metadata carrying a non-null OSS ETag from a universal server HEAD.
  - **Risk if wrong**: B preserves provider coupling without adding SHA-256 integrity.
- `ETag`
  - **Interpretation A**: HTTP entity tag backed by DB row version, required for concurrent administrator mutations.
  - **Interpretation B**: OSS response ETag stored as file metadata.
  - **Risk if wrong**: Removing B may accidentally remove A, or B may be defended using A's unrelated concurrency purpose.

## Open Questions
- Can completed OSS objects be deleted or mutated outside updater-admin? If yes, define asynchronous integrity monitoring or an explicit activation-time policy; do not silently restore universal interactive HEAD.
- Is there any real external consumer of authenticated `POST /api/v1/uploads/complete`? Updater-admin source evidence found none.

## Verdict Justification
The scoped review remains REVISE. The justified architecture is the draft lifecycle, expected-count finalization, bounded metadata batches, immutable complete manifests, cursor-paginated backend API, deterministic keys, overwrite prohibition and single-flight STS manager. The updater-admin simplification required before further implementation is: global path+hash reuse, no OSS ETag business field, selective rather than universal HEAD, one resolve transaction, and one draft-scoped completion path.
