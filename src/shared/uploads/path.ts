import { isWellFormedUnicode } from "../api/common";
import { MAX_UPLOAD_PATH_CODE_POINTS, SHA256_PATTERN } from "../api/uploads";

export const UPLOAD_PATH_ERROR_CODES = [
	"ABSOLUTE",
	"BACKSLASH",
	"CONTROL_CHARACTER",
	"DOT_SEGMENT",
	"DUPLICATE",
	"EMPTY",
	"EMPTY_SEGMENT",
	"ILL_FORMED_UNICODE",
	"TOO_LONG",
] as const;

export type UploadPathErrorCode = (typeof UPLOAD_PATH_ERROR_CODES)[number];

export class UploadPathValidationError extends Error {
	readonly code: UploadPathErrorCode;
	readonly path?: string;

	constructor(code: UploadPathErrorCode, path?: string) {
		super(`Invalid upload path: ${code}`);
		this.name = "UploadPathValidationError";
		this.code = code;
		this.path = path;
	}
}

function codePointLength(value: string): number {
	return Array.from(value).length;
}

function hasControlCharacter(value: string): boolean {
	return /\p{Cc}/u.test(value);
}

/** Canonical NFC relative POSIX path shared by browser and server. */
export function normalizeUploadPath(value: string): string {
	if (value.length === 0) throw new UploadPathValidationError("EMPTY");
	if (!isWellFormedUnicode(value)) {
		throw new UploadPathValidationError("ILL_FORMED_UNICODE");
	}
	if (value.startsWith("/") || /^[A-Za-z]:\//.test(value)) {
		throw new UploadPathValidationError("ABSOLUTE", value);
	}
	if (value.includes("\\")) {
		throw new UploadPathValidationError("BACKSLASH", value);
	}
	if (hasControlCharacter(value)) {
		throw new UploadPathValidationError("CONTROL_CHARACTER", value);
	}

	const normalized = value.normalize("NFC");
	if (codePointLength(normalized) > MAX_UPLOAD_PATH_CODE_POINTS) {
		throw new UploadPathValidationError("TOO_LONG", normalized);
	}

	const segments = normalized.split("/");
	if (segments.some((segment) => segment.length === 0)) {
		throw new UploadPathValidationError("EMPTY_SEGMENT", normalized);
	}
	if (segments.some((segment) => segment === "." || segment === "..")) {
		throw new UploadPathValidationError("DOT_SEGMENT", normalized);
	}

	return normalized;
}

export function normalizeUploadPaths(values: readonly string[]): string[] {
	const normalizedPaths: string[] = [];
	const seen = new Set<string>();

	for (const value of values) {
		const normalized = normalizeUploadPath(value);
		if (seen.has(normalized)) {
			throw new UploadPathValidationError("DUPLICATE", normalized);
		}
		seen.add(normalized);
		normalizedPaths.push(normalized);
	}

	return normalizedPaths;
}

export function normalizeUploadPrefix(value: string): string {
	if (value.length === 0) throw new UploadPathValidationError("EMPTY");
	if (value === "/") throw new UploadPathValidationError("ABSOLUTE", value);
	const withoutTrailingSlash = value.endsWith("/") ? value.slice(0, -1) : value;
	return `${normalizeUploadPath(withoutTrailingSlash)}/`;
}

export function isCanonicalSha256(value: string): boolean {
	return SHA256_PATTERN.test(value);
}
