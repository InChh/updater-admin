import { describe, expect, it } from "vitest";

import type { FileMetadataDto } from "./files";
import {
	type CompleteUploadsRequest,
	type CompleteUploadsResponse,
	DECIMAL_BYTE_SIZE_PATTERN,
	DRAFT_FILE_RESOLVE_STATUSES,
	MAX_COMPLETE_UPLOAD_FILES,
	MAX_RESOLVE_DRAFT_FILES,
	MAX_UPLOAD_MIME_TYPE_CODE_POINTS,
	MAX_UPLOAD_OBJECT_KEY_BYTES,
	MAX_UPLOAD_PATH_CODE_POINTS,
	MAX_UPLOAD_SIZE_BYTES,
	type ResolveDraftFilesRequest,
	type ResolveDraftFilesResponse,
	SHA256_PATTERN,
	type TemporaryOssCredentials,
	UPLOAD_MIME_TYPE_PATTERN,
	UPLOAD_OBJECT_NOT_FOUND_FIELD_CODE,
	UPLOAD_OBJECT_NOT_FOUND_PROBLEM_CODE,
	type UploadCredentialsRequest,
	type UploadCredentialsResponse,
} from "./uploads";

describe("upload API contract", () => {
	it("publishes only bounded per-request upload limits", () => {
		expect(MAX_RESOLVE_DRAFT_FILES).toBe(100);
		expect(MAX_COMPLETE_UPLOAD_FILES).toBe(25);
		expect(MAX_UPLOAD_SIZE_BYTES).toBe(41_943_040_000n);
		expect(MAX_UPLOAD_PATH_CODE_POINTS).toBe(1_024);
		expect(MAX_UPLOAD_OBJECT_KEY_BYTES).toBe(1_023);
		expect(MAX_UPLOAD_MIME_TYPE_CODE_POINTS).toBe(255);
	});

	it("publishes a distinct missing-object reconciliation contract", () => {
		expect(UPLOAD_OBJECT_NOT_FOUND_PROBLEM_CODE).toBe(
			"UPLOAD_OBJECT_NOT_FOUND",
		);
		expect(UPLOAD_OBJECT_NOT_FOUND_FIELD_CODE).toBe("OBJECT_NOT_FOUND");
	});

	it("accepts only bounded browser media types", () => {
		for (const value of [
			"application/octet-stream",
			"application/vnd.example.release+zip",
			"image/svg+xml",
		]) {
			expect(UPLOAD_MIME_TYPE_PATTERN.test(value)).toBe(true);
		}
		for (const value of ["", "/", "not a mime", "text/plain; charset=utf-8"]) {
			expect(UPLOAD_MIME_TYPE_PATTERN.test(value)).toBe(false);
		}
	});

	it("accepts only canonical lowercase hashes and decimal byte counts", () => {
		expect(SHA256_PATTERN.test("a".repeat(64))).toBe(true);
		expect(SHA256_PATTERN.test("A".repeat(64))).toBe(false);
		expect(SHA256_PATTERN.test("a".repeat(63))).toBe(false);
		expect(DECIMAL_BYTE_SIZE_PATTERN.test("0")).toBe(true);
		expect(
			DECIMAL_BYTE_SIZE_PATTERN.test(MAX_UPLOAD_SIZE_BYTES.toString()),
		).toBe(true);
		expect(DECIMAL_BYTE_SIZE_PATTERN.test("01")).toBe(false);
		expect(DECIMAL_BYTE_SIZE_PATTERN.test("-1")).toBe(false);
	});

	it("keeps bounded draft metadata requests separate from file bodies", () => {
		const request: ResolveDraftFilesRequest = {
			files: [
				{
					mimeType: "application/octet-stream",
					path: "release/app.bin",
					sha256: "a".repeat(64),
					size: "4096",
				},
			],
		};

		expect(request.files[0]).toEqual({
			mimeType: "application/octet-stream",
			path: "release/app.bin",
			sha256: "a".repeat(64),
			size: "4096",
		});
		expect(request.files[0]).not.toHaveProperty("body");
		expect(request.files[0]).not.toHaveProperty("file");
	});

	it("defines ordered draft reuse results", () => {
		const response: ResolveDraftFilesResponse = {
			files: [
				{ path: "reused.bin", status: "reused" },
				{
					canonicalMimeType: "application/octet-stream",
					path: "existing.bin",
					status: "alreadyAssociated",
				},
				{ path: "new.bin", status: "uploadRequired" },
			],
		};

		expect(DRAFT_FILE_RESOLVE_STATUSES).toEqual([
			"alreadyAssociated",
			"reused",
			"uploadRequired",
		]);
		expect(
			response.files.map(({ path, status }) => ({ path, status })),
		).toEqual([
			{ path: "reused.bin", status: "reused" },
			{ path: "existing.bin", status: "alreadyAssociated" },
			{ path: "new.bin", status: "uploadRequired" },
		]);
	});

	it("allows completion reconciliation without a browser ETag proof", () => {
		const request: CompleteUploadsRequest = {
			files: [
				{
					mimeType: "application/octet-stream",
					objectKey: `updater-admin/${"a".repeat(64)}/release/app.bin`,
					path: "release/app.bin",
					sha256: "a".repeat(64),
					size: "4096",
				},
			],
		};

		expect(request.files[0]).not.toHaveProperty("objectEtag");
	});

	it("issues one file-agnostic, prefix-scoped temporary credential set", () => {
		const request: UploadCredentialsRequest = {};
		const credentials: TemporaryOssCredentials = {
			accessKeyId: "STS.temporary-id",
			accessKeySecret: "temporary-secret",
			expiration: "2026-07-15T00:15:00.000Z",
			securityToken: "temporary-token",
		};
		const response: UploadCredentialsResponse = {
			bucket: "release-bucket",
			credentials,
			region: "oss-cn-hangzhou",
			uploadPrefix: "updater-admin/",
		};

		expect(request).toEqual({});
		expect(response.credentials).toBe(credentials);
		expect(response.uploadPrefix).toBe("updater-admin/");
		expect(response).not.toHaveProperty("objects");
		expect(response).not.toHaveProperty("permanentAccessKeyId");
		expect(response).not.toHaveProperty("permanentAccessKeySecret");
	});

	it("returns canonical metadata without OSS locations or credentials", () => {
		const file: FileMetadataDto = {
			checksumAlgorithm: "sha256",
			createdAt: "2026-07-15T00:00:00.000Z",
			id: "file-1",
			mimeType: "application/octet-stream",
			path: "release/app.bin",
			sha256: "a".repeat(64),
			size: "4096",
			updatedAt: "2026-07-15T00:00:00.000Z",
		};
		const response: CompleteUploadsResponse = { files: [file] };

		expect(response.files[0]).toBe(file);
		expect(response.files[0]).not.toHaveProperty("objectKey");
		expect(response.files[0]).not.toHaveProperty("accessKeySecret");
		expect(response.files[0]).not.toHaveProperty("securityToken");
	});
});
