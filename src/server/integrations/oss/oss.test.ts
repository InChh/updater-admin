import { describe, expect, it } from "vitest";

import { MAX_UPLOAD_OBJECT_KEY_BYTES } from "../../../shared/api/uploads";
import { createUploadObjectKey as createSharedUploadObjectKey } from "../../../shared/uploads/object-key";
import {
	createUploadObjectKey,
	type UploadObjectKeyValidationError,
} from "./object-key";
import {
	normalizeUploadPath,
	normalizeUploadPaths,
	normalizeUploadPrefix,
	type UploadPathValidationError,
} from "./path";

const SHA256 = "a".repeat(64);

function expectPathError(
	value: string,
	code: UploadPathValidationError["code"],
) {
	expect(() => normalizeUploadPath(value)).toThrowError(
		expect.objectContaining({ code }),
	);
}

describe("OSS upload path", () => {
	it("normalizes valid relative POSIX paths to NFC", () => {
		expect(normalizeUploadPath("release/app.bin")).toBe("release/app.bin");
		expect(normalizeUploadPath("nested/e\u0301.txt")).toBe("nested/é.txt");
		expect(normalizeUploadPath("spaces are valid/app (1).zip")).toBe(
			"spaces are valid/app (1).zip",
		);
	});

	it("rejects absolute, empty, traversal, ambiguous, and control paths", () => {
		expectPathError("", "EMPTY");
		expectPathError("/release/app.bin", "ABSOLUTE");
		expectPathError("C:/release/app.bin", "ABSOLUTE");
		expectPathError("release\\app.bin", "BACKSLASH");
		expectPathError("release//app.bin", "EMPTY_SEGMENT");
		expectPathError("release/", "EMPTY_SEGMENT");
		expectPathError("release/./app.bin", "DOT_SEGMENT");
		expectPathError("release/../app.bin", "DOT_SEGMENT");
		expectPathError("release/\0app.bin", "CONTROL_CHARACTER");
		expectPathError("release/\u009fapp.bin", "CONTROL_CHARACTER");
		expectPathError("release/\ud800app.bin", "ILL_FORMED_UNICODE");
	});

	it("measures the normalized path in Unicode code points", () => {
		expect(normalizeUploadPath("😀".repeat(1_024))).toBe("😀".repeat(1_024));
		expectPathError("😀".repeat(1_025), "TOO_LONG");
	});

	it("rejects duplicate paths after normalization", () => {
		expect(() => normalizeUploadPaths(["e\u0301.txt", "é.txt"])).toThrowError(
			expect.objectContaining({ code: "DUPLICATE", path: "é.txt" }),
		);
		expect(normalizeUploadPaths(["A/app.bin", "a/app.bin"])).toEqual([
			"A/app.bin",
			"a/app.bin",
		]);
	});

	it("normalizes a safe configured prefix to one trailing slash", () => {
		expect(normalizeUploadPrefix("updater-admin")).toBe("updater-admin/");
		expect(normalizeUploadPrefix("release/artifacts/")).toBe(
			"release/artifacts/",
		);
		expect(() => normalizeUploadPrefix("/release/")).toThrowError(
			expect.objectContaining({ code: "ABSOLUTE" }),
		);
		expect(() => normalizeUploadPrefix("")).toThrowError(
			expect.objectContaining({ code: "EMPTY" }),
		);
		expect(() => normalizeUploadPrefix("/")).toThrowError(
			expect.objectContaining({ code: "ABSOLUTE" }),
		);
		expect(() => normalizeUploadPrefix("release//")).toThrowError(
			expect.objectContaining({ code: "EMPTY_SEGMENT" }),
		);
	});
});

describe("OSS object key", () => {
	it("is deterministic across shared and server imports for Unicode paths", () => {
		const decomposed = createUploadObjectKey({
			path: "release/e\u0301/app.bin",
			prefix: "updater-admin",
			sha256: SHA256,
		});
		const composed = createUploadObjectKey({
			path: "release/é/app.bin",
			prefix: "updater-admin/",
			sha256: SHA256,
		});
		const shared = createSharedUploadObjectKey({
			path: "release/e\u0301/app.bin",
			prefix: "updater-admin",
			sha256: SHA256,
		});

		expect(decomposed).toBe(composed);
		expect(shared).toBe(composed);
		expect(composed).toBe(`updater-admin/${SHA256}/release/%C3%A9/app.bin`);
	});

	it("percent-encodes reserved characters without encoding separators", () => {
		expect(
			createUploadObjectKey({
				path: "folder/a b#c?d%2F!'()*.zip",
				prefix: "updater-admin/",
				sha256: SHA256,
			}),
		).toBe(
			`updater-admin/${SHA256}/folder/a%20b%23c%3Fd%252F%21%27%28%29%2A.zip`,
		);
	});

	it("rejects non-canonical hashes", () => {
		for (const sha256 of [
			"A".repeat(64),
			"a".repeat(63),
			`${"a".repeat(63)}g`,
		]) {
			expect(() =>
				createUploadObjectKey({
					path: "release/app.bin",
					prefix: "updater-admin/",
					sha256,
				}),
			).toThrowError(
				expect.objectContaining<Partial<UploadObjectKeyValidationError>>({
					code: "INVALID_SHA256",
				}),
			);
		}
	});

	it("enforces the OSS object-key UTF-8 byte limit after encoding", () => {
		const fixedLength = `p/${SHA256}/`.length;
		const exactPath = "a".repeat(MAX_UPLOAD_OBJECT_KEY_BYTES - fixedLength);
		expect(
			createUploadObjectKey({
				path: exactPath,
				prefix: "p/",
				sha256: SHA256,
			}),
		).toHaveLength(MAX_UPLOAD_OBJECT_KEY_BYTES);
		expect(() =>
			createUploadObjectKey({
				path: `${exactPath}a`,
				prefix: "p/",
				sha256: SHA256,
			}),
		).toThrowError(expect.objectContaining({ code: "TOO_LONG" }));

		const multibytePrefixOverflow = "a".repeat(
			MAX_UPLOAD_OBJECT_KEY_BYTES - `x/${SHA256}/`.length,
		);
		expect(() =>
			createUploadObjectKey({
				path: multibytePrefixOverflow,
				prefix: "界/",
				sha256: SHA256,
			}),
		).toThrowError(expect.objectContaining({ code: "TOO_LONG" }));
	});
});
