import { describe, expect, it, vi } from "vitest";

import {
	DraftIncompleteRepositoryError,
	VersionFinalizedRequiredRepositoryError,
	type VersionRecord,
	VersionStaleWriteRepositoryError,
	type VersionsRepository,
} from "../db/repositories/versions.server";
import {
	createVersionsService,
	type DraftIncompleteError,
	VersionFinalizedRequiredError,
	VersionPreconditionRequiredError,
	VersionStaleWriteError,
	type VersionsValidationError,
} from "./versions.server";

const PROGRAM_ID = "00000000-0000-4000-8000-000000000010";
const VERSION_ID = "00000000-0000-4000-8000-000000000020";
const ACTOR_ID = "00000000-0000-4000-8000-000000000001";
const NOW = new Date("2026-08-06T01:00:00.000Z");

const audit = {
	actorId: ACTOR_ID,
	ip: "127.0.0.1",
	requestId: "req_versions",
	userAgent: "vitest",
} as const;

function version(overrides: Partial<VersionRecord> = {}): VersionRecord {
	return {
		associatedFileCount: 0,
		createdAt: NOW,
		createdBy: ACTOR_ID,
		description: "Release",
		expectedFileCount: 3,
		fileCount: 0,
		finalizedAt: null,
		id: VERSION_ID,
		isActive: false,
		isLatest: false,
		lifecycleStatus: "draft",
		programId: PROGRAM_ID,
		rowVersion: 1n,
		updatedAt: NOW,
		updatedBy: ACTOR_ID,
		versionMajor: 2,
		versionMinor: 0,
		versionNumber: "2.0.0",
		versionPatch: 0,
		...overrides,
	};
}

function repository(
	overrides: Partial<VersionsRepository> = {},
): VersionsRepository {
	return {
		createDraft: vi.fn(async () => version()),
		delete: vi.fn(async () => {}),
		finalize: vi.fn(async () =>
			version({
				associatedFileCount: 3,
				fileCount: 3,
				finalizedAt: NOW,
				lifecycleStatus: "finalized",
				rowVersion: 2n,
			}),
		),
		findById: vi.fn(async () => version()),
		list: vi.fn(async () => ({ items: [version()], total: 1 })),
		setActivation: vi.fn(async () =>
			version({
				finalizedAt: NOW,
				isActive: true,
				lifecycleStatus: "finalized",
				rowVersion: 2n,
			}),
		),
		update: vi.fn(async () => version({ rowVersion: 2n })),
		...overrides,
	};
}

describe("versions service", () => {
	it("creates an inactive draft without a full file ID array", async () => {
		const createDraft = vi.fn(async () => version());
		const service = createVersionsService({
			now: () => NOW,
			repository: repository({ createDraft }),
		});

		await expect(
			service.createDraft(
				PROGRAM_ID,
				{
					description: " Release ",
					expectedFileCount: 3,
					versionNumber: "2.0.0",
				},
				audit,
			),
		).resolves.toMatchObject({
			data: {
				associatedFileCount: 0,
				expectedFileCount: 3,
				lifecycleStatus: "draft",
			},
			etag: 'W/"1"',
		});
		expect(createDraft).toHaveBeenCalledWith({
			audit,
			description: "Release",
			expectedFileCount: 3,
			programId: PROGRAM_ID,
			versionMajor: 2,
			versionMinor: 0,
			versionNumber: "2.0.0",
			versionPatch: 0,
		});
	});

	it("rejects empty and non-integer expected counts", async () => {
		const service = createVersionsService({ repository: repository() });
		for (const expectedFileCount of [0, 1.5, 2_147_483_648]) {
			await expect(
				service.createDraft(
					PROGRAM_ID,
					{ expectedFileCount, versionNumber: "2.0.0" },
					audit,
				),
			).rejects.toMatchObject({
				fieldErrors: [{ code: "INVALID_VALUE", path: "expectedFileCount" }],
			} satisfies Partial<VersionsValidationError>);
		}
	});

	it("finalizes atomically using the supplied ETag", async () => {
		const finalize = vi.fn(async () =>
			version({
				associatedFileCount: 3,
				fileCount: 3,
				finalizedAt: NOW,
				lifecycleStatus: "finalized",
				rowVersion: 2n,
			}),
		);
		const service = createVersionsService({
			now: () => NOW,
			repository: repository({ finalize }),
		});

		await expect(
			service.finalize(PROGRAM_ID, VERSION_ID, 'W/"1"', audit),
		).resolves.toMatchObject({
			data: { fileCount: 3, lifecycleStatus: "finalized" },
			etag: 'W/"2"',
		});
		expect(finalize).toHaveBeenCalledWith({
			audit,
			expectedRowVersion: 1n,
			id: VERSION_ID,
			now: NOW,
			programId: PROGRAM_ID,
		});
	});

	it("rejects missing and stale finalization ETags", async () => {
		const service = createVersionsService({ repository: repository() });
		await expect(
			service.finalize(PROGRAM_ID, VERSION_ID, null, audit),
		).rejects.toBeInstanceOf(VersionPreconditionRequiredError);
		await expect(
			service.finalize(PROGRAM_ID, VERSION_ID, "stale", audit),
		).rejects.toBeInstanceOf(VersionStaleWriteError);
	});

	it("maps incomplete finalization without changing the public DTO", async () => {
		const service = createVersionsService({
			repository: repository({
				finalize: vi.fn(() =>
					Promise.reject(new DraftIncompleteRepositoryError(3, 2)),
				),
			}),
		});
		await expect(
			service.finalize(PROGRAM_ID, VERSION_ID, 'W/"1"', audit),
		).rejects.toMatchObject({
			actual: 2,
			expected: 3,
		} satisfies Partial<DraftIncompleteError>);
	});

	it("rejects activation of a draft", async () => {
		const service = createVersionsService({
			repository: repository({
				setActivation: vi.fn(async () => {
					throw new VersionFinalizedRequiredRepositoryError();
				}),
			}),
		});
		await expect(
			service.setActivation(
				PROGRAM_ID,
				VERSION_ID,
				'W/"1"',
				{ isActive: true },
				audit,
			),
		).rejects.toBeInstanceOf(VersionFinalizedRequiredError);
	});

	it("maps a repository stale write during finalization", async () => {
		const service = createVersionsService({
			repository: repository({
				finalize: vi.fn(() =>
					Promise.reject(new VersionStaleWriteRepositoryError()),
				),
			}),
		});
		await expect(
			service.finalize(PROGRAM_ID, VERSION_ID, 'W/"1"', audit),
		).rejects.toBeInstanceOf(VersionStaleWriteError);
	});

	it("keeps migrated finalized versions listable", async () => {
		const migrated = version({
			expectedFileCount: null,
			finalizedAt: NOW,
			isActive: true,
			isLatest: true,
			lifecycleStatus: "finalized",
		});
		const service = createVersionsService({
			repository: repository({
				list: vi.fn(async () => ({ items: [migrated], total: 1 })),
			}),
		});
		await expect(
			service.list(PROGRAM_ID, {
				page: 1,
				pageSize: 20,
				sort: "createdAt:desc",
			}),
		).resolves.toMatchObject({
			items: [
				{
					expectedFileCount: null,
					isActive: true,
					isLatest: true,
					lifecycleStatus: "finalized",
				},
			],
		});
	});
});
