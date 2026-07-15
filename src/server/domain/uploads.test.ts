import { describe, expect, it, vi } from "vitest";

import {
	MAX_COMPLETE_UPLOAD_FILES,
	MAX_UPLOAD_FILES,
	MAX_UPLOAD_SIZE_BYTES,
	type TemporaryOssCredentials,
} from "../../shared/api/uploads";
import type { AuditRepository } from "../db/repositories/audit.server";
import {
	type CompleteUploadsRepositoryInput,
	type RegisteredUploadMetadata,
	UploadMetadataConflictRepositoryError,
	type UploadsRepository,
} from "../db/repositories/uploads.server";
import type { OssMetadataClient } from "../integrations/oss/client.server";
import { OssMetadataError } from "../integrations/oss/client.server";
import { createUploadObjectKey } from "../integrations/oss/object-key";
import {
	UploadStsError,
	type UploadStsService,
} from "../integrations/oss/sts.server";
import {
	createUploadsService,
	normalizeUploadEtag,
	UploadCredentialsUnavailableError,
	UploadMetadataConflictError,
	UploadObjectNotFoundError,
	UploadsValidationError,
	UploadVerificationUnavailableError,
} from "./uploads.server";

const ACTOR_ID = "00000000-0000-4000-8000-000000000001";
const FILE_ID = "00000000-0000-4000-8000-000000000002";
const SHA256 = "a".repeat(64);
const CONFIGURATION = {
	bucket: "updater-artifacts",
	region: "oss-cn-hangzhou",
	uploadPrefix: "releases/",
} as const;
const audit = {
	actorId: ACTOR_ID,
	ip: "203.0.113.8",
	requestId: "req_test",
	userAgent: "vitest",
} as const;
const credentials: TemporaryOssCredentials = {
	accessKeyId: "STS.temporary",
	accessKeySecret: "temporary-secret",
	expiration: "2026-07-15T01:15:00.000Z",
	securityToken: "temporary-token",
};

function baseFile(overrides: Record<string, unknown> = {}) {
	return {
		mimeType: "application/octet-stream",
		path: "desktop/app.bin",
		sha256: SHA256,
		size: "42",
		...overrides,
	};
}

function completeFile(overrides: Record<string, unknown> = {}) {
	return {
		...baseFile(),
		objectEtag: '"etag-1"',
		objectKey: createUploadObjectKey({
			path: "desktop/app.bin",
			prefix: CONFIGURATION.uploadPrefix,
			sha256: SHA256,
		}),
		...overrides,
	};
}

function reconciliationFile(overrides: Record<string, unknown> = {}) {
	return {
		...baseFile(),
		objectKey: createUploadObjectKey({
			path: "desktop/app.bin",
			prefix: CONFIGURATION.uploadPrefix,
			sha256: SHA256,
		}),
		...overrides,
	};
}

function stored(
	overrides: Partial<RegisteredUploadMetadata> = {},
): RegisteredUploadMetadata {
	return {
		checksumAlgorithm: "sha256",
		createdAt: new Date("2026-07-15T01:00:00.000Z"),
		id: FILE_ID,
		mimeType: "application/octet-stream",
		objectEtag: "etag-1",
		objectKey: completeFile().objectKey,
		path: "desktop/app.bin",
		rowVersion: 1n,
		sha256: SHA256,
		size: 42n,
		updatedAt: new Date("2026-07-15T01:00:00.000Z"),
		...overrides,
	};
}

function repository(
	overrides: Partial<UploadsRepository> = {},
): UploadsRepository {
	return {
		complete: vi.fn(async () => [stored()]),
		...overrides,
	};
}

function metadataClient(
	overrides: Partial<OssMetadataClient> = {},
): OssMetadataClient {
	return {
		headObject: vi.fn(async () => ({ etag: "etag-1", size: 42n })),
		...overrides,
	};
}

function stsService(
	overrides: Partial<UploadStsService> = {},
): UploadStsService {
	return {
		issueUploadCredentials: vi.fn(async () => credentials),
		...overrides,
	};
}

function auditRepository(
	overrides: Partial<AuditRepository> = {},
): AuditRepository {
	return {
		append: vi.fn(async () => ({
			createdAt: new Date("2026-07-15T01:00:00.000Z"),
			id: "00000000-0000-4000-8000-000000000003",
		})),
		...overrides,
	};
}

describe("uploads service", () => {
	it("keeps every external owner lazy until its operation needs it", async () => {
		const getConfiguration = vi.fn(() => CONFIGURATION);
		const getMetadataClient = vi.fn(() => metadataClient());
		const getRepository = vi.fn(() => repository());
		const getStsService = vi.fn(() => stsService());
		const getAuditRepository = vi.fn(() => auditRepository());
		const service = createUploadsService({
			getAuditRepository,
			getConfiguration,
			getMetadataClient,
			getRepository,
			getStsService,
		});

		expect(getConfiguration).not.toHaveBeenCalled();
		expect(getMetadataClient).not.toHaveBeenCalled();
		expect(getRepository).not.toHaveBeenCalled();
		expect(getStsService).not.toHaveBeenCalled();
		expect(getAuditRepository).not.toHaveBeenCalled();

		await service.issueCredentials({ files: [baseFile()] }, audit);
		expect(getConfiguration).toHaveBeenCalledOnce();
		expect(getStsService).toHaveBeenCalledOnce();
		expect(getAuditRepository).toHaveBeenCalledOnce();
		expect(getMetadataClient).not.toHaveBeenCalled();
		expect(getRepository).not.toHaveBeenCalled();
	});

	it("normalizes paths and returns only short-lived credentials and deterministic targets", async () => {
		const issueUploadCredentials = vi.fn(async () => credentials);
		const append = vi.fn(async () => ({
			createdAt: new Date("2026-07-15T01:00:00.000Z"),
			id: "00000000-0000-4000-8000-000000000003",
		}));
		const service = createUploadsService({
			auditRepository: auditRepository({ append }),
			configuration: CONFIGURATION,
			stsService: stsService({ issueUploadCredentials }),
		});
		const response = await service.issueCredentials(
			{
				files: [baseFile({ path: "desktop/cafe\u0301 app.bin" })],
			},
			audit,
		);

		expect(issueUploadCredentials).toHaveBeenCalledWith({ actorId: ACTOR_ID });
		expect(response).toEqual({
			bucket: CONFIGURATION.bucket,
			credentials,
			objects: [
				{
					objectKey: createUploadObjectKey({
						path: "desktop/café app.bin",
						prefix: CONFIGURATION.uploadPrefix,
						sha256: SHA256,
					}),
					path: "desktop/café app.bin",
				},
			],
			region: CONFIGURATION.region,
		});
		expect(response).not.toHaveProperty("accessKeySecret");
		expect(append).toHaveBeenCalledWith({
			action: "upload.credentials.issued",
			actorId: audit.actorId,
			after: { fileCount: 1 },
			before: null,
			ip: audit.ip,
			requestId: audit.requestId,
			resourceId: audit.requestId,
			resourceType: "upload",
			result: "success",
			userAgent: audit.userAgent,
		});
	});

	it("rejects count, normalized paths, hashes, sizes, and unsafe MIME values", async () => {
		const issueUploadCredentials = vi.fn(async () => credentials);
		const service = createUploadsService({
			configuration: CONFIGURATION,
			stsService: stsService({ issueUploadCredentials }),
		});

		for (const files of [
			[],
			Array.from({ length: MAX_UPLOAD_FILES + 1 }, baseFile),
		]) {
			await expect(
				service.issueCredentials({ files } as never, audit),
			).rejects.toBeInstanceOf(UploadsValidationError);
		}
		await expect(
			service.issueCredentials(
				{
					files: [
						baseFile({ path: "desktop/café.bin" }),
						baseFile({ path: "desktop/cafe\u0301.bin" }),
					],
				},
				audit,
			),
		).rejects.toMatchObject({
			fieldErrors: [{ code: "DUPLICATE_VALUE", path: "files.1.path" }],
		});

		for (const invalid of [
			baseFile({ path: "../app.bin" }),
			baseFile({ sha256: "A".repeat(64) }),
			baseFile({ size: "01" }),
			baseFile({ size: (MAX_UPLOAD_SIZE_BYTES + 1n).toString() }),
			baseFile({ mimeType: "text/plain\nunsafe" }),
			baseFile({ mimeType: " ".repeat(3) }),
			baseFile({ mimeType: "not a mime" }),
			baseFile({ mimeType: "/" }),
		]) {
			await expect(
				service.issueCredentials({ files: [invalid] } as never, audit),
			).rejects.toBeInstanceOf(UploadsValidationError);
		}
		expect(issueUploadCredentials).not.toHaveBeenCalled();
	});

	it("rejects an oversized encoded object key before issuing STS credentials", async () => {
		const issueUploadCredentials = vi.fn(async () => credentials);
		const service = createUploadsService({
			configuration: CONFIGURATION,
			stsService: stsService({ issueUploadCredentials }),
		});

		await expect(
			service.issueCredentials(
				{ files: [baseFile({ path: `${"😀".repeat(100)}.bin` })] },
				audit,
			),
		).rejects.toMatchObject({
			fieldErrors: [{ code: "TOO_LONG", path: "files.0.path" }],
			name: UploadsValidationError.name,
		});
		expect(issueUploadCredentials).not.toHaveBeenCalled();
	});

	it("maps STS provider and response failures to one secret-free outage", async () => {
		for (const code of ["ASSUME_ROLE_FAILED", "INVALID_RESPONSE"] as const) {
			const service = createUploadsService({
				configuration: CONFIGURATION,
				stsService: stsService({
					issueUploadCredentials: async () => {
						throw new UploadStsError(code);
					},
				}),
			});
			await expect(
				service.issueCredentials({ files: [baseFile()] }, audit),
			).rejects.toBeInstanceOf(UploadCredentialsUnavailableError);
		}
	});

	it("canonicalizes safe quoted ETags and rejects unbalanced or control values", () => {
		expect(normalizeUploadEtag(' "abc-1" ')).toBe("abc-1");
		expect(normalizeUploadEtag("abc-1")).toBe("abc-1");
		expect(normalizeUploadEtag('"abc')).toBeNull();
		expect(normalizeUploadEtag("abc\n1")).toBeNull();
		expect(normalizeUploadEtag(" ")).toBeNull();
	});

	it("HEAD-verifies every object with bounded concurrency before one atomic completion", async () => {
		let inFlight = 0;
		let maximumInFlight = 0;
		const headObject = vi.fn(async () => {
			inFlight += 1;
			maximumInFlight = Math.max(maximumInFlight, inFlight);
			await new Promise((resolve) => setTimeout(resolve, 1));
			inFlight -= 1;
			return { etag: "etag-1", size: 42n };
		});
		const complete = vi.fn(async ({ files }: CompleteUploadsRepositoryInput) =>
			files.map((file, index) =>
				stored({
					...file,
					id: `00000000-0000-4000-8000-${String(index + 2).padStart(12, "0")}`,
				}),
			),
		);
		const files = Array.from({ length: 7 }, (_, index) => {
			const path = `desktop/app-${index}.bin`;
			return completeFile({
				objectKey: createUploadObjectKey({
					path,
					prefix: CONFIGURATION.uploadPrefix,
					sha256: SHA256,
				}),
				path,
			});
		});
		const service = createUploadsService({
			configuration: CONFIGURATION,
			headConcurrency: 3,
			metadataClient: metadataClient({ headObject }),
			repository: repository({ complete }),
		});

		const response = await service.complete({ files }, audit);

		expect(headObject).toHaveBeenCalledTimes(7);
		expect(maximumInFlight).toBe(3);
		expect(complete).toHaveBeenCalledOnce();
		expect(complete).toHaveBeenCalledWith({
			audit,
			files: expect.arrayContaining([
				expect.objectContaining({
					objectEtag: "etag-1",
					path: "desktop/app-0.bin",
					size: 42n,
				}),
			]),
		});
		expect(response.files).toHaveLength(7);
		expect(response.files[0]).toMatchObject({
			checksumAlgorithm: "sha256",
			objectEtag: "etag-1",
			size: "42",
		});
		expect(response.files[0]).not.toHaveProperty("objectKey");
	});

	it("rejects oversized completion batches before OSS or repository work", async () => {
		const headObject = vi.fn(async () => ({ etag: "etag-1", size: 42n }));
		const complete = vi.fn(async () => [stored()]);
		const files = Array.from(
			{ length: MAX_COMPLETE_UPLOAD_FILES + 1 },
			(_, index) => {
				const path = `desktop/app-${index}.bin`;
				return reconciliationFile({
					objectKey: createUploadObjectKey({
						path,
						prefix: CONFIGURATION.uploadPrefix,
						sha256: SHA256,
					}),
					path,
				});
			},
		);
		const service = createUploadsService({
			configuration: CONFIGURATION,
			metadataClient: metadataClient({ headObject }),
			repository: repository({ complete }),
		});

		await expect(service.complete({ files }, audit)).rejects.toMatchObject({
			fieldErrors: [{ code: "TOO_MANY", path: "files" }],
			name: UploadsValidationError.name,
		});
		expect(headObject).not.toHaveBeenCalled();
		expect(complete).not.toHaveBeenCalled();
	});

	it("recovers a committed object after the browser loses the OSS response", async () => {
		const complete = vi.fn(async ({ files }: CompleteUploadsRepositoryInput) =>
			files.map((file) => stored(file)),
		);
		const service = createUploadsService({
			configuration: CONFIGURATION,
			metadataClient: metadataClient({
				headObject: async () => ({ etag: '"etag-1"', size: 42n }),
			}),
			repository: repository({ complete }),
		});

		const response = await service.complete(
			{ files: [reconciliationFile()] },
			audit,
		);

		expect(complete).toHaveBeenCalledWith({
			audit,
			files: [
				expect.objectContaining({
					objectEtag: "etag-1",
					objectKey: reconciliationFile().objectKey,
					size: 42n,
				}),
			],
		});
		expect(response.files[0]).toMatchObject({
			id: FILE_ID,
			objectEtag: "etag-1",
		});
	});

	it("preserves caller order while canonical HEAD proofs resolve out of order", async () => {
		const paths = ["desktop/z.bin", "desktop/a.bin", "desktop/m.bin"];
		const canonicalEtags = new Map(
			paths.map((path, index) => [path, `canonical-${index}`] as const),
		);
		const files = paths.map((path) =>
			reconciliationFile({
				objectKey: createUploadObjectKey({
					path,
					prefix: CONFIGURATION.uploadPrefix,
					sha256: SHA256,
				}),
				path,
			}),
		);
		const complete = vi.fn(async ({ files }: CompleteUploadsRepositoryInput) =>
			files.map((file, index) =>
				stored({
					...file,
					id: `00000000-0000-4000-8000-${String(index + 2).padStart(12, "0")}`,
				}),
			),
		);
		const service = createUploadsService({
			configuration: CONFIGURATION,
			headConcurrency: 3,
			metadataClient: metadataClient({
				headObject: async (objectKey) => {
					const path = paths.find((candidate) => objectKey.endsWith(candidate));
					if (!path) throw new Error("Unexpected object key.");
					await new Promise((resolve) =>
						setTimeout(
							resolve,
							path === paths[0] ? 5 : path === paths[1] ? 1 : 3,
						),
					);
					return { etag: `"${canonicalEtags.get(path)}"`, size: 42n };
				},
			}),
			repository: repository({ complete }),
		});

		const response = await service.complete({ files }, audit);

		const repositoryFiles = complete.mock.calls[0]?.[0].files;
		expect(repositoryFiles?.map((file) => file.path)).toEqual(paths);
		expect(repositoryFiles?.map((file) => file.objectEtag)).toEqual(
			paths.map((path) => canonicalEtags.get(path)),
		);
		expect(response.files.map((file) => file.path)).toEqual(paths);
		expect(response.files.map((file) => file.objectEtag)).toEqual(
			paths.map((path) => canonicalEtags.get(path)),
		);
	});

	it("rejects a noncanonical object key before contacting OSS", async () => {
		const headObject = vi.fn(async () => ({ etag: "etag-1", size: 42n }));
		const complete = vi.fn(async () => [stored()]);
		const service = createUploadsService({
			configuration: CONFIGURATION,
			metadataClient: metadataClient({ headObject }),
			repository: repository({ complete }),
		});

		await expect(
			service.complete(
				{
					files: [completeFile({ objectKey: "releases/wrong/app.bin" })],
				},
				audit,
			),
		).rejects.toMatchObject({
			fieldErrors: [{ code: "CONFLICT", path: "files.0.objectKey" }],
			name: UploadMetadataConflictError.name,
		});
		expect(headObject).not.toHaveBeenCalled();
		expect(complete).not.toHaveBeenCalled();
	});

	it("rejects a malformed supplied ETag instead of treating it as reconciliation", async () => {
		const headObject = vi.fn(async () => ({ etag: "etag-1", size: 42n }));
		const complete = vi.fn(async () => [stored()]);
		const service = createUploadsService({
			configuration: CONFIGURATION,
			metadataClient: metadataClient({ headObject }),
			repository: repository({ complete }),
		});

		await expect(
			service.complete(
				{ files: [completeFile({ objectEtag: '"unbalanced' })] },
				audit,
			),
		).rejects.toMatchObject({
			fieldErrors: [{ code: "INVALID_VALUE", path: "files.0.objectEtag" }],
			name: UploadsValidationError.name,
		});
		expect(headObject).not.toHaveBeenCalled();
		expect(complete).not.toHaveBeenCalled();
	});

	it("returns a distinct missing-object error for reconciliation", async () => {
		const complete = vi.fn(async () => [stored()]);
		const service = createUploadsService({
			configuration: CONFIGURATION,
			metadataClient: metadataClient({
				headObject: async () => {
					throw new OssMetadataError("OBJECT_NOT_FOUND");
				},
			}),
			repository: repository({ complete }),
		});

		await expect(
			service.complete({ files: [reconciliationFile()] }, audit),
		).rejects.toMatchObject({
			fieldErrors: [{ code: "OBJECT_NOT_FOUND", path: "files.0.objectKey" }],
			name: UploadObjectNotFoundError.name,
		});
		expect(complete).not.toHaveBeenCalled();
	});

	it("rejects size mismatches and supplied ETag mismatches", async () => {
		const cases = [
			{
				client: metadataClient({
					headObject: async () => ({ etag: "etag-1", size: 43n }),
				}),
				file: reconciliationFile(),
				path: "files.0.size",
			},
			{
				client: metadataClient({
					headObject: async () => ({ etag: "etag-2", size: 42n }),
				}),
				file: completeFile(),
				path: "files.0.objectEtag",
			},
		] as const;

		for (const testCase of cases) {
			const complete = vi.fn(async () => [stored()]);
			const service = createUploadsService({
				configuration: CONFIGURATION,
				metadataClient: testCase.client,
				repository: repository({ complete }),
			});
			await expect(
				service.complete({ files: [testCase.file] }, audit),
			).rejects.toMatchObject({
				fieldErrors: [{ code: "CONFLICT", path: testCase.path }],
				name: UploadMetadataConflictError.name,
			});
			expect(complete).not.toHaveBeenCalled();
		}
	});

	it("rejects an invalid canonical HEAD ETag before repository completion", async () => {
		const complete = vi.fn(async () => [stored()]);
		const service = createUploadsService({
			configuration: CONFIGURATION,
			metadataClient: metadataClient({
				headObject: async () => ({ etag: '"unbalanced', size: 42n }),
			}),
			repository: repository({ complete }),
		});

		await expect(
			service.complete({ files: [reconciliationFile()] }, audit),
		).rejects.toMatchObject({
			fieldErrors: [{ code: "CONFLICT", path: "files.0.objectKey" }],
			name: UploadMetadataConflictError.name,
		});
		expect(complete).not.toHaveBeenCalled();
	});

	it("surfaces the lowest-index conflict deterministically across concurrent HEADs", async () => {
		const paths = ["desktop/app-0.bin", "desktop/app-1.bin"];
		const files = paths.map((path) =>
			completeFile({
				objectKey: createUploadObjectKey({
					path,
					prefix: CONFIGURATION.uploadPrefix,
					sha256: SHA256,
				}),
				path,
			}),
		);
		const service = createUploadsService({
			configuration: CONFIGURATION,
			headConcurrency: 2,
			metadataClient: metadataClient({
				headObject: async (objectKey) => {
					if (objectKey.includes("app-0.bin")) {
						await new Promise((resolve) => setTimeout(resolve, 5));
						return { etag: "etag-1", size: 43n };
					}
					return { etag: "etag-2", size: 42n };
				},
			}),
			repository: repository(),
		});

		await expect(service.complete({ files }, audit)).rejects.toMatchObject({
			fieldErrors: [{ code: "CONFLICT", path: "files.0.size" }],
		});
	});

	it("maps persisted proof conflicts without leaking repository details", async () => {
		const service = createUploadsService({
			configuration: CONFIGURATION,
			metadataClient: metadataClient(),
			repository: repository({
				complete: async () => {
					throw new UploadMetadataConflictRepositoryError(
						0,
						"private/path.bin",
					);
				},
			}),
		});

		await expect(
			service.complete({ files: [completeFile()] }, audit),
		).rejects.toEqual(
			expect.objectContaining({
				fieldErrors: [{ code: "CONFLICT", path: "files.0" }],
				name: UploadMetadataConflictError.name,
			}),
		);
	});

	it("does not disguise an OSS dependency outage as submitted metadata", async () => {
		const service = createUploadsService({
			configuration: CONFIGURATION,
			metadataClient: metadataClient({
				headObject: async () => {
					throw new OssMetadataError("HEAD_FAILED");
				},
			}),
			repository: repository(),
		});

		await expect(
			service.complete({ files: [completeFile()] }, audit),
		).rejects.toBeInstanceOf(UploadVerificationUnavailableError);
	});
});
