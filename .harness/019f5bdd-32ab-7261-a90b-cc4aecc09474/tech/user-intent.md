# User Intent

## Goal

Redesign the release-folder upload lifecycle so the browser can upload an arbitrary number of program files directly to Aliyun OSS without a product-level total file-count ceiling, while the backend only performs bounded metadata verification, persistence, and version association work.

## Confirmed Requirements

- Do not impose a fixed total file-count limit on a selected program folder or version.
- Request one prefix-scoped STS credential set per validity window, not one credential set per artificial file batch.
- Refresh STS credentials only when they are too close to expiration or have expired.
- Continue direct browser-to-OSS multipart upload; file bodies must never pass through Netlify Functions.
- Keep backend metadata verification and persistence bounded through batches.
- Support incremental upload: if a selected file with the same canonical relative path, SHA-256, and byte size was already uploaded for a prior finalized version of the same program and the OSS object is still valid, associate it directly and skip upload.
- Keep every finalized version self-contained even when physical OSS objects are reused; do not model releases as a chain of deltas.
- Preserve canonical relative paths, SHA-256, size, MIME type, object-key verification, idempotency, optimistic concurrency, and anonymous public release consumption.
- Design only in this stage; do not implement source changes.

## Scope

- Upload credential contract and lifecycle.
- Browser object-key derivation and credential refresh.
- Metadata completion and version association lifecycle.
- Version create/edit behavior for large file sets.
- Public release manifest behavior for large file sets.
- Failure recovery, idempotency, security, observability, migration, tests, and rollout.

## Non-Goals

- Changing OSS bucket/provider.
- Proxying file bodies through the application backend.
- Billing, tenancy, or client compatibility with the legacy UpdaterServer protocol.
- Implementing the design in this stage.

## Work Intent

- Type: architecture correction / implementation-ready technical design.
- Complexity: high.
