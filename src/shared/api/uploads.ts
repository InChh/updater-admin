import type { FileMetadataDto } from "./files";

/** One credentials or completion request may describe at most this many files. */
export const MAX_UPLOAD_FILES = 1_000;

/** Intentional product limit per release file: 5 TiB, represented exactly. */
export const MAX_UPLOAD_SIZE_BYTES = 5_497_558_138_880n;

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

/** Metadata proof returned by OSS after a direct browser upload. */
export interface CompleteUploadItemInput extends UploadFileMetadataInput {
	readonly objectEtag: string;
	readonly objectKey: string;
}

export interface CompleteUploadsRequest {
	readonly files: readonly CompleteUploadItemInput[];
}

/** Idempotent completion returns the canonical, secret-free metadata rows. */
export interface CompleteUploadsResponse {
	readonly files: readonly FileMetadataDto[];
}
