import { describe, expect, it } from "vitest";

import {
	FILE_MAX_PAGE,
	FILE_PAGE_SIZES,
	FILE_SORTS,
	type FileMetadataDto,
	VERSION_FILE_SORTS,
} from "./files";

describe("file API contract", () => {
	it("keeps global and nested sorts closed over their approved sets", () => {
		expect(FILE_SORTS).toEqual([
			"path:asc",
			"path:desc",
			"createdAt:desc",
			"createdAt:asc",
		]);
		expect(VERSION_FILE_SORTS).toEqual(["path:asc", "path:desc"]);
		expect(FILE_PAGE_SIZES).toEqual([20, 50, 100]);
		expect(FILE_MAX_PAGE).toBe(1_000_000);
	});

	it("serializes bigint byte sizes as decimal strings without object locations", () => {
		const file: FileMetadataDto = {
			checksumAlgorithm: "sha256",
			createdAt: "2026-07-15T00:00:00.000Z",
			id: "file-1",
			mimeType: "application/octet-stream",
			objectEtag: null,
			path: "release/app.bin",
			sha256: "a".repeat(64),
			size: "9223372036854775807",
			updatedAt: "2026-07-15T00:00:00.000Z",
		};

		expect(file.size).toBe("9223372036854775807");
		expect(file).not.toHaveProperty("objectKey");
	});
});
