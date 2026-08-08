import { Buffer } from "node:buffer";

import { describe, expect, it, vi } from "vitest";

import { PUBLIC_RELEASE_DOWNLOAD_REQUEST_MAX_ITEMS } from "../../shared/api/public-releases";
import type {
	PublicReleaseFileMetadataRecord,
	PublicReleaseFilePageLookup,
	PublicReleaseRecord,
	PublicReleasesRepository,
	PublicReleasesV2Repository,
} from "../db/repositories/public-releases.server";
import type { OssDownloadUrlSigner } from "../integrations/oss/download-url.server";
import {
	createPublicReleasesService,
	PUBLIC_RELEASE_SIGNING_CONCURRENCY,
	PublicReleaseCursorError,
	PublicReleaseNotFoundError,
} from "./public-releases.server";

const PROGRAM_ID = "00000000-0000-4000-8000-000000000010";
const VERSION = {
	versionMajor: 10,
	versionMinor: 2,
	versionNumber: "10.2.3",
	versionPatch: 3,
} as const;

function release(
	overrides: Partial<PublicReleaseRecord> = {},
): PublicReleaseRecord {
	return {
		description: "Desktop release",
		files: [
			{
				checksumAlgorithm: "sha256",
				mimeType: "application/octet-stream",
				objectKey: "private/a/app.bin",
				path: "a/app.bin",
				sha256: "a".repeat(64),
				size: 42n,
			},
			{
				checksumAlgorithm: "sha256",
				mimeType: "text/plain",
				objectKey: "private/b/readme.txt",
				path: "b/readme.txt",
				sha256: "b".repeat(64),
				size: 9_007_199_254_740_993n,
			},
		],
		programId: PROGRAM_ID,
		programName: "Desktop",
		publishedAt: new Date("2026-07-20T01:02:03.000Z"),
		versionNumber: VERSION.versionNumber,
		...overrides,
	};
}

function repository(
	overrides: Partial<PublicReleasesRepository> = {},
): PublicReleasesRepository {
	return {
		findActiveByVersionNumber: vi.fn(async () => release()),
		findLatestActive: vi.fn(async () => release()),
		...overrides,
	};
}

function v2Repository(
	overrides: Partial<PublicReleasesV2Repository> = {},
): PublicReleasesV2Repository {
	return {
		findDownloadFiles: vi.fn(async () => []),
		findFilePage: vi.fn(
			async (): Promise<PublicReleaseFilePageLookup> => ({
				page: { items: [], nextPath: null },
				status: "found",
			}),
		),
		findHeaderByVersionNumber: vi.fn(async () => ({
			description: "Desktop release",
			fileCount: 5,
			programName: "Desktop",
			publishedAt: new Date("2026-07-20T01:02:03.000Z"),
			versionNumber: VERSION.versionNumber,
		})),
		findLatestHeader: vi.fn(async () => ({
			description: "Desktop release",
			fileCount: 5,
			programName: "Desktop",
			publishedAt: new Date("2026-07-20T01:02:03.000Z"),
			versionNumber: VERSION.versionNumber,
		})),
		...overrides,
	};
}

function signer(
	overrides: Partial<OssDownloadUrlSigner> = {},
): OssDownloadUrlSigner {
	return {
		signGetUrl: vi.fn(
			async (objectKey) =>
				`https://bucket.example/${encodeURIComponent(objectKey)}?x-oss-signature=safe`,
		),
		...overrides,
	};
}

function metadata(
	path: string,
	index: number,
): PublicReleaseFileMetadataRecord {
	return {
		checksumAlgorithm: "sha256",
		mimeType: "application/octet-stream",
		path,
		sha256: index.toString(16).padStart(64, "0"),
		size: BigInt(index),
	};
}

describe("public releases service", () => {
	it("preserves the complete v1 manifest and 300-second signed URL contract", async () => {
		const releasesRepository = repository();
		const downloadSigner = signer();
		const now = vi.fn(() => new Date("2026-07-20T02:00:00.000Z"));
		const service = createPublicReleasesService({
			now,
			repository: releasesRepository,
			signer: downloadSigner,
		});

		const result = await service.getLatest(PROGRAM_ID);

		expect(result).toEqual({
			description: "Desktop release",
			downloadExpiresAt: "2026-07-20T02:05:00.000Z",
			files: [
				{
					checksumAlgorithm: "sha256",
					downloadUrl:
						"https://bucket.example/private%2Fa%2Fapp.bin?x-oss-signature=safe",
					mimeType: "application/octet-stream",
					path: "a/app.bin",
					sha256: "a".repeat(64),
					size: "42",
				},
				{
					checksumAlgorithm: "sha256",
					downloadUrl:
						"https://bucket.example/private%2Fb%2Freadme.txt?x-oss-signature=safe",
					mimeType: "text/plain",
					path: "b/readme.txt",
					sha256: "b".repeat(64),
					size: "9007199254740993",
				},
			],
			programId: PROGRAM_ID,
			programName: "Desktop",
			publishedAt: "2026-07-20T01:02:03.000Z",
			versionNumber: VERSION.versionNumber,
		});
		expect(now).toHaveBeenCalledOnce();
		expect(downloadSigner.signGetUrl).toHaveBeenCalledTimes(2);
		expect(JSON.stringify(result)).not.toContain("objectKey");
	});

	it("returns v2 headers without constructing a signer", async () => {
		const findHeaderByVersionNumber = vi.fn(
			async () =>
				({
					description: "Finalized release",
					fileCount: 10_001,
					programName: "Desktop",
					publishedAt: new Date("2026-08-06T01:02:03.000Z"),
					versionNumber: "10.2.3",
				}) as const,
		);
		const getSigner = vi.fn(() => signer());
		const service = createPublicReleasesService({
			getSigner,
			v2Repository: v2Repository({ findHeaderByVersionNumber }),
		});

		await expect(
			service.getHeaderByVersionNumber(PROGRAM_ID, "10.2.3"),
		).resolves.toEqual({
			description: "Finalized release",
			fileCount: 10_001,
			programName: "Desktop",
			publishedAt: "2026-08-06T01:02:03.000Z",
			versionNumber: "10.2.3",
		});
		expect(findHeaderByVersionNumber).toHaveBeenCalledWith(PROGRAM_ID, VERSION);
		expect(getSigner).not.toHaveBeenCalled();
	});

	it("traverses three immutable path-cursor pages without duplicates or omissions", async () => {
		const files = [
			metadata("a/app.bin", 1),
			metadata("b/app.bin", 2),
			metadata("c/app.bin", 3),
			metadata("d/app.bin", 4),
			metadata("e/app.bin", 5),
		];
		const findFilePage = vi.fn(async ({ afterPath, pageSize }) => {
			const start =
				afterPath === undefined
					? 0
					: files.findIndex(({ path }) => path === afterPath) + 1;
			if (start === 0 && afterPath !== undefined) {
				return { status: "cursorNotFound" } as const;
			}
			const items = files.slice(start, start + pageSize);
			return {
				page: {
					items,
					nextPath:
						start + pageSize < files.length
							? (items.at(-1)?.path ?? null)
							: null,
				},
				status: "found" as const,
			};
		});
		const getSigner = vi.fn(() => signer());
		const service = createPublicReleasesService({
			getSigner,
			v2Repository: v2Repository({ findFilePage }),
		});
		const traversed: string[] = [];
		let cursor: string | undefined;

		do {
			const page = await service.getFilePage(PROGRAM_ID, "10.2.3", {
				...(cursor === undefined ? {} : { cursor }),
				pageSize: 2,
			});
			traversed.push(...page.items.map(({ path }) => path));
			cursor = page.nextCursor ?? undefined;
		} while (cursor !== undefined);

		expect(traversed).toEqual(files.map(({ path }) => path));
		expect(new Set(traversed).size).toBe(files.length);
		expect(findFilePage).toHaveBeenCalledTimes(3);
		expect(findFilePage).toHaveBeenNthCalledWith(
			2,
			expect.objectContaining({ afterPath: "b/app.bin", pageSize: 2 }),
		);
		expect(findFilePage).toHaveBeenNthCalledWith(
			3,
			expect.objectContaining({ afterPath: "d/app.bin", pageSize: 2 }),
		);
		expect(getSigner).not.toHaveBeenCalled();
	});

	it("rejects malformed and non-member cursors without signing or leaking paths", async () => {
		const getSigner = vi.fn(() => signer());
		const findFilePage = vi.fn(
			async () => ({ status: "cursorNotFound" }) as const,
		);
		const service = createPublicReleasesService({
			getSigner,
			v2Repository: v2Repository({ findFilePage }),
		});

		await expect(
			service.getFilePage(PROGRAM_ID, "10.2.3", { cursor: "%%%" }),
		).rejects.toBeInstanceOf(PublicReleaseCursorError);
		await expect(
			service.getFilePage(PROGRAM_ID, "10.2.3", {
				cursor: Buffer.from("tampered/path.bin", "utf8").toString("base64url"),
			}),
		).rejects.toBeInstanceOf(PublicReleaseCursorError);
		expect(findFilePage).toHaveBeenCalledOnce();
		expect(getSigner).not.toHaveBeenCalled();
	});

	it("signs only exact requested path and SHA identities in request order", async () => {
		const downloadSigner = signer();
		const findDownloadFiles = vi.fn(async () => [
			{
				objectKey: "private/c.bin",
				path: "c.bin",
				sha256: "c".repeat(64),
			},
			{
				objectKey: "private/a.bin",
				path: "a.bin",
				sha256: "a".repeat(64),
			},
		]);
		const service = createPublicReleasesService({
			now: () => new Date("2026-08-06T02:00:00.000Z"),
			signer: downloadSigner,
			v2Repository: v2Repository({ findDownloadFiles }),
		});

		const result = await service.getDownloadUrls(PROGRAM_ID, "10.2.3", {
			files: [
				{ path: "a.bin", sha256: "a".repeat(64) },
				{ path: "c.bin", sha256: "c".repeat(64) },
			],
		});

		expect(result.files.map(({ path }) => path)).toEqual(["a.bin", "c.bin"]);
		expect(result.downloadExpiresAt).toBe("2026-08-06T02:05:00.000Z");
		expect(downloadSigner.signGetUrl).toHaveBeenCalledTimes(2);
		expect(downloadSigner.signGetUrl).toHaveBeenNthCalledWith(
			1,
			"private/a.bin",
		);
		expect(downloadSigner.signGetUrl).toHaveBeenNthCalledWith(
			2,
			"private/c.bin",
		);
		expect(JSON.stringify(result)).not.toMatch(
			/objectKey|etag|fileId|versionId/,
		);
	});

	it("rejects path or hash tampering before constructing the signer", async () => {
		const getSigner = vi.fn(() => signer());
		const service = createPublicReleasesService({
			getSigner,
			v2Repository: v2Repository({
				findDownloadFiles: async () => [],
			}),
		});

		await expect(
			service.getDownloadUrls(PROGRAM_ID, "10.2.3", {
				files: [{ path: "tampered.bin", sha256: "f".repeat(64) }],
			}),
		).rejects.toBeInstanceOf(PublicReleaseNotFoundError);
		expect(getSigner).not.toHaveBeenCalled();
	});

	it("rejects an unbounded direct signing request before repository work", async () => {
		const findDownloadFiles = vi.fn(async () => []);
		const service = createPublicReleasesService({
			v2Repository: v2Repository({ findDownloadFiles }),
		});

		await expect(
			service.getDownloadUrls(PROGRAM_ID, "10.2.3", {
				files: Array.from(
					{ length: PUBLIC_RELEASE_DOWNLOAD_REQUEST_MAX_ITEMS + 1 },
					(_, index) => ({
						path: `${index}.bin`,
						sha256: index.toString(16).padStart(64, "0"),
					}),
				),
			}),
		).rejects.toBeInstanceOf(PublicReleaseNotFoundError);
		expect(findDownloadFiles).not.toHaveBeenCalled();
	});

	it("bounds selective signing concurrency while preserving request order", async () => {
		const fileCount = PUBLIC_RELEASE_SIGNING_CONCURRENCY * 2 + 3;
		const files = Array.from({ length: fileCount }, (_, index) => ({
			objectKey: `private/file-${index}.bin`,
			path: `file-${index.toString().padStart(2, "0")}.bin`,
			sha256: index.toString(16).padStart(64, "0"),
		}));
		let active = 0;
		let maximumActive = 0;
		const pending: Array<{ resolve(): void }> = [];
		const signGetUrl = vi.fn(
			(objectKey: string) =>
				new Promise<string>((resolve) => {
					active += 1;
					maximumActive = Math.max(maximumActive, active);
					pending.push({
						resolve: () => {
							active -= 1;
							resolve(`https://bucket.example/${objectKey}`);
						},
					});
				}),
		);
		const service = createPublicReleasesService({
			signer: { signGetUrl },
			v2Repository: v2Repository({
				findDownloadFiles: async () => [...files].reverse(),
			}),
		});
		const resultPromise = service.getDownloadUrls(PROGRAM_ID, "10.2.3", {
			files: files.map(({ path, sha256 }) => ({ path, sha256 })),
		});

		let completed = 0;
		while (completed < fileCount) {
			const expectedBatchSize = Math.min(
				PUBLIC_RELEASE_SIGNING_CONCURRENCY,
				fileCount - completed,
			);
			await vi.waitFor(() => expect(pending).toHaveLength(expectedBatchSize));
			const batch = pending.splice(0).reverse();
			for (const operation of batch) operation.resolve();
			completed += batch.length;
		}
		const result = await resultPromise;

		expect(maximumActive).toBe(PUBLIC_RELEASE_SIGNING_CONCURRENCY);
		expect(result.files.map(({ path }) => path)).toEqual(
			files.map(({ path }) => path),
		);
	});

	it("returns one enumeration-resistant error for malformed or unavailable versions", async () => {
		const findHeaderByVersionNumber = vi.fn(async () => null);
		const findFilePage = vi.fn(
			async () => ({ status: "releaseNotFound" }) as const,
		);
		const service = createPublicReleasesService({
			v2Repository: v2Repository({
				findFilePage,
				findHeaderByVersionNumber,
			}),
		});

		await expect(
			service.getHeaderByVersionNumber(PROGRAM_ID, "01.2.3"),
		).rejects.toBeInstanceOf(PublicReleaseNotFoundError);
		await expect(
			service.getHeaderByVersionNumber(PROGRAM_ID, "10.2.3"),
		).rejects.toBeInstanceOf(PublicReleaseNotFoundError);
		await expect(
			service.getFilePage(PROGRAM_ID, "10.2.3", {}),
		).rejects.toBeInstanceOf(PublicReleaseNotFoundError);
		expect(findHeaderByVersionNumber).toHaveBeenCalledOnce();
		expect(findFilePage).toHaveBeenCalledOnce();
	});
});
