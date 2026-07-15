import type { FileMetadataDto } from "./files";

/** One folder selection or credentials request may describe this many files. */
export const MAX_UPLOAD_FILES = 1_000;

/**
 * Completion performs one canonical OSS HEAD per file inside a Netlify
 * function. Keep each request small enough to stay inside the function latency
 * envelope; the browser splits larger selections into ordered batches.
 */
export const MAX_COMPLETE_UPLOAD_FILES = 25;

/** Stable reconciliation problem identifiers consumed by the browser retry path. */
export const UPLOAD_OBJECT_NOT_FOUND_PROBLEM_CODE =
	"UPLOAD_OBJECT_NOT_FOUND" as const;
export const UPLOAD_OBJECT_NOT_FOUND_FIELD_CODE = "OBJECT_NOT_FOUND" as const;

/**
 * Browser-safe product limit per release file: 10,000 explicit 4 MiB parts.
 * This must mirror MAX_OSS_MULTIPART_FILE_SIZE_BYTES without importing a
 * client-only module into the shared/server graph.
 */
export const MAX_UPLOAD_SIZE_BYTES = 41_943_040_000n;

export const MAX_UPLOAD_PATH_CODE_POINTS = 1_024;
/** Aliyun OSS object keys may contain at most 1,023 UTF-8 bytes. */
export const MAX_UPLOAD_OBJECT_KEY_BYTES = 1_023;
export const MAX_UPLOAD_MIME_TYPE_CODE_POINTS = 255;

/** A browser File.type value: one ASCII RFC token, slash, then one token. */
export const UPLOAD_MIME_TYPE_PATTERN =
	/^[A-Za-z0-9!#$%&'*+.^_`|~-]+\/[A-Za-z0-9!#$%&'*+.^_`|~-]+$/;

/** Canonical lowercase SHA-256 and non-negative decimal byte-count grammars. */
export const SHA256_PATTERN = /^[0-9a-f]{64}$/;
export const DECIMAL_BYTE_SIZE_PATTERN = /^(0|[1-9][0-9]*)$/;

/**
 * Metadata sent to Netlify before an upload. File bodies remain in the browser
 * and are transferred directly to OSS.
 */
export interface UploadFileMetadataInput {
	readonly mimeType: string;
	readonly path: string;
	readonly sha256: string;
	/** Canonical decimal bytes, bounded to {@link MAX_UPLOAD_SIZE_BYTES}. */
	readonly size: string;
}

export interface UploadCredentialsRequest {
	readonly files: readonly UploadFileMetadataInput[];
}

/** Deterministic destination for one normalized relative path. */
export interface UploadObjectTarget {
	readonly objectKey: string;
	readonly path: string;
}

/**
 * Short-lived AssumeRole credentials. This shape is deliberately separate
 * from persisted file metadata and must never contain permanent RAM keys.
 */
export interface TemporaryOssCredentials {
	readonly accessKeyId: string;
	readonly accessKeySecret: string;
	readonly expiration: string;
	readonly securityToken: string;
}

export interface UploadCredentialsResponse {
	readonly bucket: string;
	readonly credentials: TemporaryOssCredentials;
	readonly objects: readonly UploadObjectTarget[];
	readonly region: string;
}

/**
 * Metadata proof returned by OSS after a direct browser upload. Omitting the
 * ETag asks the server to reconcile a potentially successful OSS commit whose
 * browser response was lost; the server still HEAD-verifies the object before
 * registering metadata.
 */
export interface CompleteUploadItemInput extends UploadFileMetadataInput {
	readonly objectEtag?: string;
	readonly objectKey: string;
}

export interface CompleteUploadsRequest {
	readonly files: readonly CompleteUploadItemInput[];
}

/** Idempotent completion returns the canonical, secret-free metadata rows. */
export interface CompleteUploadsResponse {
	readonly files: readonly FileMetadataDto[];
}
