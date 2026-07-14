import { describe, expect, it } from "vitest";

import {
	compareUploadIdentity,
	type RegisterUploadMetadataInput,
	uploadMetadataMatches,
} from "./uploads.server";

const requested: RegisterUploadMetadataInput = {
	mimeType: "application/octet-stream",
	objectEtag: "etag-1",
	objectKey: "releases/abc/file.bin",
	path: "folder/file.bin",
	sha256: "a".repeat(64),
	size: 42n,
};

describe("uploads repository", () => {
	it("orders lock acquisition by the canonical partial-unique identity", () => {
		const inputs = [
			{ ...requested, path: "z.bin" },
			{ ...requested, path: "a.bin", sha256: "b".repeat(64) },
			{ ...requested, path: "a.bin", sha256: "a".repeat(64), size: 43n },
			{ ...requested, path: "a.bin", sha256: "a".repeat(64), size: 42n },
		];
		expect([...inputs].sort(compareUploadIdentity)).toEqual([
			inputs[3],
			inputs[2],
			inputs[1],
			inputs[0],
		]);
	});

	it("requires every persisted proof field to match an idempotent replay", () => {
		expect(uploadMetadataMatches(requested, requested)).toBe(true);
		for (const changed of [
			{ ...requested, mimeType: "text/plain" },
			{ ...requested, objectEtag: "etag-2" },
			{ ...requested, objectKey: "releases/other/file.bin" },
			{ ...requested, path: "other/file.bin" },
			{ ...requested, sha256: "b".repeat(64) },
			{ ...requested, size: 43n },
		]) {
			expect(uploadMetadataMatches(requested, changed)).toBe(false);
		}
	});
});
