import { describe, expect, it } from "vitest";

import type { FileMetadataDto } from "./files";
import {
	type CompleteUploadsResponse,
	DECIMAL_BYTE_SIZE_PATTERN,
	MAX_UPLOAD_FILES,
	MAX_UPLOAD_MIME_TYPE_CODE_POINTS,
	MAX_UPLOAD_OBJECT_KEY_BYTES,
	MAX_UPLOAD_PATH_CODE_POINTS,
	MAX_UPLOAD_SIZE_BYTES,
	SHA256_PATTERN,
	type TemporaryOssCredentials,
	UPLOAD_MIME_TYPE_PATTERN,
	type UploadCredentialsRequest,
	type UploadCredentialsResponse,
} from "./uploads";

describe("upload API contract", () => {
	it("publishes the approved browser-safe request limits", () => {
		expect(MAX_UPLOAD_FILES).toBe(1_000);
		expect(MAX_UPLOAD_SIZE_BYTES).toBe(5_497_558_138_880n);
		expect(MAX_UPLOAD_PATH_CODE_POINTS).toBe(1_024);
		expect(MAX_UPLOAD_OBJECT_KEY_BYTES).toBe(1_023);
		expect(MAX_UPLOAD_MIME_TYPE_CODE_POINTS).toBe(255);
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

	it("keeps metadata requests separate from file bodies", () => {
		const request: UploadCredentialsRequest = {
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

	it("exposes only temporary credentials alongside deterministic targets", () => {
		const credentials: TemporaryOssCredentials = {
			accessKeyId: "STS.temporary-id",
			accessKeySecret: "temporary-secret",
			expiration: "2026-07-15T00:15:00.000Z",
			securityToken: "temporary-token",
		};
		const response: UploadCredentialsResponse = {
			bucket: "release-bucket",
			credentials,
			objects: [
				{
					objectKey: `updater-admin/${"a".repeat(64)}/release/app.bin`,
					path: "release/app.bin",
				},
			],
			region: "oss-cn-hangzhou",
		};

		expect(response.credentials).toBe(credentials);
		expect(response).not.toHaveProperty("permanentAccessKeyId");
		expect(response).not.toHaveProperty("permanentAccessKeySecret");
	});

	it("returns canonical metadata without OSS locations or credentials", () => {
		const file: FileMetadataDto = {
			checksumAlgorithm: "sha256",
			createdAt: "2026-07-15T00:00:00.000Z",
			id: "file-1",
			mimeType: "application/octet-stream",
			objectEtag: "etag-1",
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
