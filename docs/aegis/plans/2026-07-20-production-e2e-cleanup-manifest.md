# Production E2E Cleanup Manifest

## Status and Authority

This is the exact deletion manifest and execution record for the known
2026-07-20 E2E data in the production Neon database. No secret value belongs in
this document or in cleanup output.

The operator explicitly confirmed this deletion set, the production
administrator identity (`admin`, `2319397152@qq.com`), and later supplied the
one-time password through ignored `.env.local`. On 2026-08-06 a fresh read-only
preflight matched every fixed target, all 18 audit IDs, one settings row, and
two migration-ledger rows; the optional rate window had already expired. The
guarded serializable transaction then deleted exactly one account,
administrator-metadata row, user, program, version, file, and version-file
relation plus all 18 audit rows and zero rate-window rows. Post-commit reads
proved all fixed targets absent and both preservation fingerprints unchanged.
The intended production administrator was then created through Better Auth and
verified as one user, one credential account, one administrator metadata row,
and zero sessions before browser login.

## Exact Target Set

| Table | Exact identity | Required guard |
| --- | --- | --- |
| `applications` | `id = 857c9256-9931-4e76-8903-37f548290cfc` | Exactly one row; it has no version other than the target version below. |
| `application_versions` | `id = ab3dd5da-79df-41d8-b9f3-f9d9b10f27f5` | Exactly one row and `application_id` is the target program. |
| `file_metadata` | `id = 618c138c-48c0-4064-985f-50feeeaa654a` | Exactly one row and it has no relation other than the target relation. |
| `version_files` | `(version_id, file_metadata_id) = (ab3dd5da-79df-41d8-b9f3-f9d9b10f27f5, 618c138c-48c0-4064-985f-50feeeaa654a)` | Exactly one row; no other relation may reference either target side. |
| `user` | `id = a50d6ca4-4361-4ce5-b962-030039de7db6` | Exactly one row; no session or unlisted dependent row may exist. |
| `account` | `id = 3fc0b094-1ff5-4f71-983e-00f5f2b69f8b` | Exactly one row and `user_id` is the target user. No other account for that user may exist. |
| `admin_metadata` | `user_id = a50d6ca4-4361-4ce5-b962-030039de7db6` | Exactly one row. |
| `rate_limit_windows` | `endpoint = 'uploads.complete.files'`, `subject_key = 'a50d6ca4-4361-4ce5-b962-030039de7db6'`, `window_started_at = '2026-07-20T03:00:00Z'` | Delete zero or one row. This exact window may expire naturally; absence is acceptable. |

The exact `audit_events.id` target set contains these 18 rows:

1. `d0fb41f5-3985-48f0-94fc-74aa08a005b3`
2. `3606b4e8-c0ca-4839-a80e-d5e764f041da`
3. `ae80d223-2353-41c4-a715-1082bee4eddf`
4. `a9529b90-21a1-4283-886c-2dace54745bc`
5. `79551e8e-ed69-4340-a563-8b35ebfb3426`
6. `8a79facd-6e66-4f85-91c6-a38a9d0a9170`
7. `a761e5a4-f71a-45a2-9e81-15d7b3a12ce4`
8. `74e69b6a-47c7-4150-b5e2-76790aa64420`
9. `e89fb16e-d817-4bb2-9196-2ffbff51c573`
10. `979ef324-51c2-40ec-91a2-c77b4a07917f`
11. `0f5c28fe-a27c-4783-b463-2852b6da9471`
12. `f9d6b115-59d8-4062-93b6-da41f975fe9f`
13. `b12262d3-d296-4d37-b671-e03a46f8d6c7`
14. `8703d281-6657-47c4-b845-fb83505bc74a`
15. `742f02dc-b80d-4b1d-99e7-d0ebfbb742f3`
16. `8688f784-4def-431e-a731-71bfc760a384`
17. `5e68df2d-83d0-445e-915e-76bbc03fbe9d`
18. `e9304118-5369-409e-987b-a7b7141ccf44`

All 18 audit IDs must still exist before execution. Discovery predicates such
as actor or resource identity may be used to detect unexpected additional E2E
rows and abort, but the delete predicate must remain the 18 explicit IDs above.

## Required Transaction Contract

1. Start one `SERIALIZABLE` database transaction. During the maintenance
   window, take `SHARE ROW EXCLUSIVE` locks on the application-owned tables in
   scope so concurrent writes cannot create phantom logical references. Do not
   auto-retry a lock timeout or serialization failure; repeat a fresh read-only
   enumeration instead.
2. Assert every fixed target and relationship above has the stated
   cardinality. Assert the target program has only the target version, the
   target version/file have only the target relation, the target user has only
   the target account and metadata row, and the target user has no sessions or
   other unlisted dependents. Any mismatch rolls back the whole transaction and
   requires a new read-only manifest.
3. Delete only by the fixed primary/composite keys in this manifest. Delete the
   version relation before its version, file, and program; delete the explicit
   account and `admin_metadata` rows before the user. Delete the 18 audit rows
   only by ID.
4. For the rate-limit row, use all three composite-key fields exactly as listed
   and accept a delete count of zero or one. Never widen the time, endpoint, or
   subject predicate to compensate for natural expiry.
5. Assert delete counts before commit: one each for program, version, file,
   version relation, user, account, and `admin_metadata`; exactly 18 audit
   rows; zero or one exact rate-limit row. Any other count rolls back.
6. Before any delete, require zero unlisted references from the target user in
   business `created_by`/`updated_by`/`deleted_by` columns,
   `system_settings.updated_by`, `session.impersonated_by`, credential
   `account_id`, `verification.identifier`, and every `rate_limit_windows`
   subject. Require the 18 explicit audits to be the complete set found by
   actor ID, target resource IDs, and target IDs embedded in audit JSON.

## Preservation Invariants

- Preserve every non-target database row. In particular, do not mutate other
  users, accounts, sessions, programs, versions, files, relations, audit rows,
  either rate-limit table, or verification rows.
- Preserve `system_settings` exactly.
- Preserve the migration ledger, schemas, tables, indexes, constraints, and
  migration files. Cleanup is row deletion only; it never drops, truncates, or
  remigrates the database.
- Preserve all Aliyun OSS objects, including the object associated with the
  target file metadata. The cleanup transaction must not call OSS or add object
  deletion authority.
- Do not log connection strings, passwords, tokens, keys, signed URLs, account
  credential material, or other secret values during preflight or execution.

## Post-transaction Gate

Completed on 2026-08-06. The exact identities are absent, the optional rate row
is absent, settings and migration fingerprints are unchanged, and no OSS
object was deleted. The production administrator login passed. Bootstrap
credentials were never uploaded to Netlify; they remain local-only and must be
removed locally when no longer needed.
