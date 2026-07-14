import { MAX_UPLOAD_OBJECT_KEY_BYTES } from "../../../shared/api/uploads";
import {
	isCanonicalSha256,
	normalizeUploadPath,
	normalizeUploadPrefix,
} from "./path";

export type UploadObjectKeyErrorCode = "INVALID_SHA256" | "TOO_LONG";

export class UploadObjectKeyValidationError extends Error {
	readonly code: UploadObjectKeyErrorCode;

	constructor(code: UploadObjectKeyErrorCode) {
		super(`Invalid upload object key: ${code}`);
		this.name = "UploadObjectKeyValidationError";
		this.code = code;
	}
}

export interface CreateUploadObjectKeyInput {
	readonly path: string;
	readonly prefix: string;
	readonly sha256: string;
}

function encodeRfc3986Segment(segment: string): string {
	return encodeURIComponent(segment).replaceAll(
		/[!'()*]/g,
		(character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
	);
}

/**
 * Builds the sole canonical OSS location for uploaded metadata. Encoding each
 * segment prevents reserved characters from changing the path structure while
 * retaining `/` as the normalized relative-path separator.
 */
export function createUploadObjectKey({
	path,
	prefix,
	sha256,
}: CreateUploadObjectKeyInput): string {
	if (!isCanonicalSha256(sha256)) {
		throw new UploadObjectKeyValidationError("INVALID_SHA256");
	}

	const normalizedPrefix = normalizeUploadPrefix(prefix);
	const normalizedPath = normalizeUploadPath(path);
	const encodedPath = normalizedPath
		.split("/")
		.map(encodeRfc3986Segment)
		.join("/");
	const objectKey = `${normalizedPrefix}${sha256}/${encodedPath}`;

	if (
		new TextEncoder().encode(objectKey).byteLength > MAX_UPLOAD_OBJECT_KEY_BYTES
	) {
		throw new UploadObjectKeyValidationError("TOO_LONG");
	}

	return objectKey;
}
