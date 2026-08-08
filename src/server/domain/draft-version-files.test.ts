import { describe, expect, it, vi } from "vitest";
import type {
	DraftFileRecord,
	DraftVersionFilesRepository,
	ResolveDraftFilesRepositoryInput,
} from "../db/repositories/draft-version-files.server";
import type { ProgramMutationContext } from "../db/repositories/programs.server";
import type { OssMetadataClient } from "../integrations/oss/client.server";
import {
	createDraftVersionFilesService,
	DraftVersionFilesValidationError,
} from "./draft-version-files.server";

const PROGRAM_ID = "ca6f79db-c7c4-4a34-9ab5-2a85ca9df501";
const VERSION_ID = "31ddcbe4-4a31-4c35-9738-e88d974a20f4";
const SHA256 = "a".repeat(64);
const AUDIT: ProgramMutationContext = {
	actorId: "ef87aa07-320c-4e32-b788-f3688309371c",
	ip: "127.0.0.1",
	requestId: "req-1",
	userAgent: "vitest",
};

function record(overrides: Partial<DraftFileRecord> = {}): DraftFileRecord {
	return {
		checksumAlgorithm: "sha256",
		createdAt: new Date("2026-08-08T00:00:00.000Z"),
		id: "704f73c0-92ac-4477-9cdf-459b428112c9",
		mimeType: "application/octet-stream",
		path: "bin/app.bin",
		sha256: SHA256,
		size: 7n,
		updatedAt: new Date("2026-08-08T00:00:00.000Z"),
		...overrides,
	};
}

function repository(
	overrides: Partial<DraftVersionFilesRepository> = {},
): DraftVersionFilesRepository {
	return {
		complete: vi.fn(async () => [record()]),
		listVersionFiles: vi.fn(async () => ({ hasMore: false, items: [] })),
		resolve: vi.fn(async (input: ResolveDraftFilesRepositoryInput) =>
			input.files.map(({ path }) => ({
				path,
				status: "uploadRequired" as const,
			})),
		),
		...overrides,
	};
}

function completion(verifyObject?: true) {
	return {
		files: [
			{
				mimeType: "application/octet-stream",
				objectKey: `releases/${SHA256}/bin/app.bin`,
				path: "bin/app.bin",
				sha256: SHA256,
				size: "7",
				...(verifyObject ? { verifyObject } : {}),
			},
		],
	};
}

describe("draft version files service", () => {
	it("resolves and associates each batch in one repository transaction", async () => {
		const resolve = vi.fn(async () => [
			{ path: "bin/app.bin", status: "reused" as const },
		]);
		const service = createDraftVersionFilesService({
			repository: repository({ resolve }),
			uploadPrefix: "releases/",
		});

		await expect(
			service.resolve(
				PROGRAM_ID,
				VERSION_ID,
				{
					files: [
						{
							mimeType: "application/octet-stream",
							path: "bin/app.bin",
							sha256: SHA256,
							size: "7",
						},
					],
				},
				AUDIT,
			),
		).resolves.toEqual({
			files: [{ path: "bin/app.bin", status: "reused" }],
		});
		expect(resolve).toHaveBeenCalledOnce();
	});

	it("registers a normal completed upload without an OSS HEAD", async () => {
		const complete = vi.fn(async () => [record()]);
		const headObject = vi.fn();
		const service = createDraftVersionFilesService({
			metadataClient: { headObject } as unknown as OssMetadataClient,
			repository: repository({ complete }),
			uploadPrefix: "releases/",
		});

		await expect(
			service.complete(PROGRAM_ID, VERSION_ID, completion(), AUDIT),
		).resolves.toMatchObject({
			files: [{ path: "bin/app.bin", sha256: SHA256, size: "7" }],
		});
		expect(headObject).not.toHaveBeenCalled();
		expect(complete).toHaveBeenCalledOnce();
	});

	it("HEAD-verifies only an explicitly ambiguous upload", async () => {
		const complete = vi.fn(async () => [record()]);
		const headObject = vi.fn(async () => ({ etag: "ignored", size: 7n }));
		const service = createDraftVersionFilesService({
			metadataClient: { headObject } as unknown as OssMetadataClient,
			repository: repository({ complete }),
			uploadPrefix: "releases/",
		});

		await service.complete(PROGRAM_ID, VERSION_ID, completion(true), AUDIT);
		expect(headObject).toHaveBeenCalledExactlyOnceWith(
			`releases/${SHA256}/bin/app.bin`,
		);
	});

	it("rejects a non-canonical object key", async () => {
		const service = createDraftVersionFilesService({
			repository: repository(),
			uploadPrefix: "releases/",
		});
		await expect(
			service.complete(
				PROGRAM_ID,
				VERSION_ID,
				{
					files: [{ ...completion().files[0], objectKey: "wrong/key" }],
				},
				AUDIT,
			),
		).rejects.toBeInstanceOf(DraftVersionFilesValidationError);
	});
});
