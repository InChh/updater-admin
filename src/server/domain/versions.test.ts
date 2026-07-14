import { describe, expect, it, vi } from "vitest";

import type { UpdateVersionInput } from "../../shared/api/versions";
import type {
	FileMetadataRecord,
	FilesRepository,
} from "../db/repositories/files.server";
import {
	type ProgramMutationContext,
	ProgramNotFoundRepositoryError,
} from "../db/repositories/programs.server";
import {
	type VersionDetailRecord,
	VersionFilesNotFoundRepositoryError,
	VersionNotFoundRepositoryError,
	VersionNotGreaterRepositoryError,
	VersionNumberConflictRepositoryError,
	type VersionRecord,
	VersionStaleWriteRepositoryError,
	type VersionsRepository,
} from "../db/repositories/versions.server";
import { ProgramNotFoundError } from "./programs.server";
import {
	createFilesService,
	createVersionsService,
	FileNotFoundError,
	VersionNotFoundError,
	VersionNotGreaterError,
	VersionNumberConflictError,
	VersionPreconditionRequiredError,
	VersionStaleWriteError,
	VersionsValidationError,
} from "./versions.server";

const PROGRAM_ID = "00000000-0000-4000-8000-000000000010";
const VERSION_ID = "00000000-0000-4000-8000-000000000020";
const FILE_ID = "00000000-0000-4000-8000-000000000030";
const SECOND_FILE_ID = "00000000-0000-4000-8000-000000000031";
const ACTOR_ID = "00000000-0000-4000-8000-000000000001";
const NOW = new Date("2026-07-15T03:00:00.000Z");
const audit: ProgramMutationContext = {
	actorId: ACTOR_ID,
	ip: "203.0.113.8",
	requestId: "req_test",
	userAgent: "test",
};

function version(overrides: Partial<VersionRecord> = {}): VersionRecord {
	return {
		createdAt: new Date("2026-07-14T01:00:00.000Z"),
		createdBy: ACTOR_ID,
		description: "Desktop build",
		fileCount: 1,
		id: VERSION_ID,
		isActive: true,
		isLatest: true,
		programId: PROGRAM_ID,
		rowVersion: 3n,
		updatedAt: new Date("2026-07-14T02:00:00.000Z"),
		updatedBy: ACTOR_ID,
		versionMajor: 1,
		versionMinor: 10,
		versionNumber: "1.10.0",
		versionPatch: 0,
		...overrides,
	};
}

function detail(
	overrides: Partial<VersionDetailRecord> = {},
): VersionDetailRecord {
	return { ...version(overrides), fileIds: [FILE_ID], ...overrides };
}

function file(overrides: Partial<FileMetadataRecord> = {}): FileMetadataRecord {
	return {
		checksumAlgorithm: "sha256",
		createdAt: new Date("2026-07-14T01:00:00.000Z"),
		createdBy: ACTOR_ID,
		id: FILE_ID,
		mimeType: "application/octet-stream",
		objectEtag: null,
		path: "release/app.bin",
		rowVersion: 7n,
		sha256: "a".repeat(64),
		size: 9_223_372_036_854_775_807n,
		updatedAt: new Date("2026-07-14T02:00:00.000Z"),
		updatedBy: ACTOR_ID,
		...overrides,
	};
}

function versionsRepository(
	overrides: Partial<VersionsRepository> = {},
): VersionsRepository {
	return {
		create: vi.fn(async () => detail({ isActive: false, isLatest: false })),
		delete: vi.fn(async () => {}),
		findById: vi.fn(async () => detail()),
		list: vi.fn(async () => ({ items: [version()], total: 1 })),
		setActivation: vi.fn(async () => detail({ rowVersion: 4n })),
		update: vi.fn(async () => detail({ rowVersion: 4n })),
		...overrides,
	};
}

function filesRepository(
	overrides: Partial<FilesRepository> = {},
): FilesRepository {
	return {
		findById: vi.fn(async () => file()),
		list: vi.fn(async () => ({ items: [file()], total: 1 })),
		listForVersion: vi.fn(async () => ({ items: [file()], total: 1 })),
		...overrides,
	};
}

describe("versions service", () => {
	it("keeps repositories lazy and maps numeric latest/list row ETags", async () => {
		const getRepository = vi.fn(() => versionsRepository());
		const service = createVersionsService({ getRepository });

		expect(getRepository).not.toHaveBeenCalled();
		const result = await service.list(PROGRAM_ID, {
			page: 2,
			pageSize: 50,
			sort: "createdAt:asc",
		});

		expect(getRepository).toHaveBeenCalledOnce();
		expect(result).toEqual({
			items: [
				expect.objectContaining({
					etag: 'W/"3"',
					isActive: true,
					isLatest: true,
					versionNumber: "1.10.0",
				}),
			],
			page: 2,
			pageSize: 50,
			total: 1,
		});
	});

	it("creates an inactive canonical version with normalized description and files", async () => {
		const create = vi.fn(async () =>
			detail({
				description: "Release notes",
				isActive: false,
				isLatest: false,
				rowVersion: 1n,
				versionNumber: "1.10.0",
			}),
		);
		const service = createVersionsService({
			repository: versionsRepository({ create }),
		});

		const result = await service.create(
			PROGRAM_ID,
			{
				description: "  Release notes  ",
				fileIds: [FILE_ID, SECOND_FILE_ID],
				versionNumber: "1.10.0",
			},
			audit,
		);

		expect(create).toHaveBeenCalledWith({
			audit,
			description: "Release notes",
			fileIds: [FILE_ID, SECOND_FILE_ID],
			isActive: false,
			programId: PROGRAM_ID,
			versionMajor: 1,
			versionMinor: 10,
			versionNumber: "1.10.0",
			versionPatch: 0,
		});
		expect(result).toMatchObject({
			data: { fileIds: [FILE_ID], isActive: false, isLatest: false },
			etag: 'W/"1"',
		});
	});

	it("rejects invalid version fields and bounded file sets before writes", async () => {
		const create = vi.fn(async () => detail());
		const service = createVersionsService({
			repository: versionsRepository({ create }),
		});

		for (const input of [
			{ fileIds: [FILE_ID], versionNumber: "01.0.0" },
			{ fileIds: [], versionNumber: "1.0.0" },
			{ fileIds: [FILE_ID, FILE_ID], versionNumber: "1.0.0" },
			{
				description: "🚀".repeat(1025),
				fileIds: [FILE_ID],
				versionNumber: "1.0.0",
			},
			{
				description: "bad\0description",
				fileIds: [FILE_ID],
				versionNumber: "1.0.0",
			},
		]) {
			await expect(
				service.create(PROGRAM_ID, input, audit),
			).rejects.toBeInstanceOf(VersionsValidationError);
		}
		await expect(
			service.create(
				PROGRAM_ID,
				{
					fileIds: Array.from({ length: 10_001 }, (_, index) =>
						index === 0 ? FILE_ID : `${index}`,
					),
					versionNumber: "1.0.0",
				},
				audit,
			),
		).rejects.toMatchObject({ fieldErrors: [{ path: "fileIds" }] });
		expect(create).not.toHaveBeenCalled();
	});

	it("maps historical progression, uniqueness, missing files, and parent failures", async () => {
		const cases = [
			{
				domain: VersionNotGreaterError,
				repository: new VersionNotGreaterRepositoryError("1.9.99"),
			},
			{
				domain: VersionNumberConflictError,
				repository: new VersionNumberConflictRepositoryError(),
			},
			{
				domain: VersionsValidationError,
				repository: new VersionFilesNotFoundRepositoryError([FILE_ID]),
			},
			{
				domain: ProgramNotFoundError,
				repository: new ProgramNotFoundRepositoryError(),
			},
		] as const;

		for (const testCase of cases) {
			const service = createVersionsService({
				repository: versionsRepository({
					create: async () => {
						throw testCase.repository;
					},
				}),
			});
			await expect(
				service.create(
					PROGRAM_ID,
					{ fileIds: [FILE_ID], versionNumber: "2.0.0" },
					audit,
				),
			).rejects.toBeInstanceOf(testCase.domain);
		}
	});

	it("preserves omitted relations and sends an explicit empty replacement", async () => {
		const update = vi.fn(async () => detail({ fileIds: [], rowVersion: 4n }));
		const service = createVersionsService({
			now: () => NOW,
			repository: versionsRepository({ update }),
		});

		await service.update(
			PROGRAM_ID,
			VERSION_ID,
			'W/"3"',
			{ description: " metadata only " },
			audit,
		);
		expect(update).toHaveBeenNthCalledWith(1, {
			audit,
			description: "metadata only",
			expectedRowVersion: 3n,
			id: VERSION_ID,
			now: NOW,
			programId: PROGRAM_ID,
		});

		await service.update(
			PROGRAM_ID,
			VERSION_ID,
			'W/"3"',
			{ fileIds: [], versionNumber: "2.0.0" },
			audit,
		);
		expect(update).toHaveBeenNthCalledWith(2, {
			audit,
			expectedRowVersion: 3n,
			fileIds: [],
			id: VERSION_ID,
			now: NOW,
			programId: PROGRAM_ID,
			versionMajor: 2,
			versionMinor: 0,
			versionNumber: "2.0.0",
			versionPatch: 0,
		});
	});

	it("requires an exact ETag, rejects empty updates, and maps stale writes", async () => {
		const update = vi.fn(async () => detail());
		const service = createVersionsService({
			repository: versionsRepository({ update }),
		});

		await expect(
			service.update(
				PROGRAM_ID,
				VERSION_ID,
				null,
				{ description: "next" },
				audit,
			),
		).rejects.toBeInstanceOf(VersionPreconditionRequiredError);
		await expect(
			service.update(
				PROGRAM_ID,
				VERSION_ID,
				'W/"9223372036854775808"',
				{ description: "next" },
				audit,
			),
		).rejects.toBeInstanceOf(VersionStaleWriteError);
		await expect(
			service.update(
				PROGRAM_ID,
				VERSION_ID,
				'W/"3"',
				{} as UpdateVersionInput,
				audit,
			),
		).rejects.toMatchObject({
			fieldErrors: [{ code: "AT_LEAST_ONE_REQUIRED", path: "$" }],
		});

		const stale = createVersionsService({
			repository: versionsRepository({
				update: async () => {
					throw new VersionStaleWriteRepositoryError();
				},
			}),
		});
		await expect(
			stale.update(
				PROGRAM_ID,
				VERSION_ID,
				'W/"3"',
				{ description: "next" },
				audit,
			),
		).rejects.toBeInstanceOf(VersionStaleWriteError);
		expect(update).not.toHaveBeenCalled();
	});

	it("sets only the addressed activation state and soft-deletes by row version", async () => {
		const setActivation = vi.fn(async () =>
			detail({ isActive: false, isLatest: false, rowVersion: 4n }),
		);
		const remove = vi.fn(async () => {});
		const service = createVersionsService({
			now: () => NOW,
			repository: versionsRepository({ delete: remove, setActivation }),
		});

		const result = await service.setActivation(
			PROGRAM_ID,
			VERSION_ID,
			'W/"3"',
			{ isActive: false },
			audit,
		);
		expect(setActivation).toHaveBeenCalledWith({
			audit,
			expectedRowVersion: 3n,
			id: VERSION_ID,
			isActive: false,
			now: NOW,
			programId: PROGRAM_ID,
		});
		expect(result).toMatchObject({
			data: { isActive: false, isLatest: false },
			etag: 'W/"4"',
		});

		await service.delete(PROGRAM_ID, VERSION_ID, 'W/"4"', audit);
		expect(remove).toHaveBeenCalledWith({
			audit,
			expectedRowVersion: 4n,
			id: VERSION_ID,
			now: NOW,
			programId: PROGRAM_ID,
		});
	});

	it("returns detail and maps missing nested versions", async () => {
		const service = createVersionsService({
			repository: versionsRepository(),
		});
		await expect(
			service.getById(PROGRAM_ID, VERSION_ID),
		).resolves.toMatchObject({
			data: { fileIds: [FILE_ID], id: VERSION_ID },
			etag: 'W/"3"',
		});

		const missing = createVersionsService({
			repository: versionsRepository({ findById: async () => null }),
		});
		await expect(
			missing.getById(PROGRAM_ID, VERSION_ID),
		).rejects.toBeInstanceOf(VersionNotFoundError);

		const nestedMissing = createVersionsService({
			filesRepository: filesRepository({
				listForVersion: async () => {
					throw new VersionNotFoundRepositoryError();
				},
			}),
		});
		await expect(
			nestedMissing.listFiles(PROGRAM_ID, VERSION_ID, {
				page: 1,
				pageSize: 20,
				sort: "path:asc",
			}),
		).rejects.toBeInstanceOf(VersionNotFoundError);
	});
});

describe("files service", () => {
	it("normalizes literal path search and serializes bigint metadata safely", async () => {
		const list = vi.fn(async () => ({ items: [file()], total: 1 }));
		const service = createFilesService({
			repository: filesRepository({ list }),
		});

		const result = await service.list({
			page: 2,
			pageSize: 100,
			path: "  release_%  ",
			sort: "path:desc",
		});

		expect(list).toHaveBeenCalledWith({
			page: 2,
			pageSize: 100,
			path: "release_%",
			sort: "path:desc",
		});
		expect(result.items[0]).toMatchObject({
			checksumAlgorithm: "sha256",
			size: "9223372036854775807",
		});
		expect(result.items[0]).not.toHaveProperty("objectKey");
	});

	it("returns a file detail ETag and maps missing metadata", async () => {
		const service = createFilesService({ repository: filesRepository() });
		await expect(service.getById(FILE_ID)).resolves.toMatchObject({
			data: { id: FILE_ID },
			etag: 'W/"7"',
		});

		const missing = createFilesService({
			repository: filesRepository({ findById: async () => null }),
		});
		await expect(missing.getById(FILE_ID)).rejects.toBeInstanceOf(
			FileNotFoundError,
		);
	});
});
