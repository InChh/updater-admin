import { describe, expect, it, vi } from "vitest";
import type { UpdateProgramInput } from "../../shared/api/programs";
import { PROGRAM_MAX_PAGE } from "../../shared/api/programs";
import {
	type ProgramDetailRecord,
	ProgramNameConflictRepositoryError,
	ProgramNotFoundRepositoryError,
	type ProgramRecord,
	ProgramStaleWriteRepositoryError,
	type ProgramsRepository,
} from "../db/repositories/programs.server";
import {
	createProgramsService,
	ProgramNameConflictError,
	ProgramNotFoundError,
	ProgramPreconditionRequiredError,
	ProgramStaleWriteError,
	ProgramsValidationError,
} from "./programs.server";

const PROGRAM_ID = "00000000-0000-4000-8000-000000000010";
const ACTOR_ID = "00000000-0000-4000-8000-000000000001";
const NOW = new Date("2026-07-15T01:00:00.000Z");
const audit = {
	actorId: ACTOR_ID,
	ip: "203.0.113.8",
	requestId: "req_test",
	userAgent: "test",
} as const;

function program(overrides: Partial<ProgramRecord> = {}): ProgramRecord {
	return {
		createdAt: new Date("2026-07-14T01:00:00.000Z"),
		createdBy: ACTOR_ID,
		description: "Desktop release",
		id: PROGRAM_ID,
		name: "Desktop",
		rowVersion: 3n,
		updatedAt: new Date("2026-07-14T02:00:00.000Z"),
		updatedBy: ACTOR_ID,
		...overrides,
	};
}

function detail(
	overrides: Partial<ProgramDetailRecord> = {},
): ProgramDetailRecord {
	return { ...program(overrides), versionCount: 4, ...overrides };
}

function repository(
	overrides: Partial<ProgramsRepository> = {},
): ProgramsRepository {
	return {
		create: vi.fn(async () => detail({ rowVersion: 1n, versionCount: 0 })),
		delete: vi.fn(async () => ({ affectedVersionCount: 4 })),
		findById: vi.fn(async () => detail()),
		list: vi.fn(async () => ({ items: [program()], total: 1 })),
		update: vi.fn(async () => detail({ rowVersion: 4n })),
		...overrides,
	};
}

describe("programs service", () => {
	it("stays lazy until a method needs the repository", async () => {
		const getRepository = vi.fn(() => repository());
		const service = createProgramsService({ getRepository });

		expect(getRepository).not.toHaveBeenCalled();
		await service.list({ page: 1, pageSize: 20, sort: "createdAt:desc" });
		expect(getRepository).toHaveBeenCalledOnce();
	});

	it("normalizes a literal case-sensitive filter and maps stable list DTOs", async () => {
		const list = vi.fn(async () => ({ items: [program()], total: 1 }));
		const service = createProgramsService({ repository: repository({ list }) });

		const result = await service.list({
			name: "  Desk_%  ",
			page: 2,
			pageSize: 50,
			sort: "createdAt:asc",
		});

		expect(list).toHaveBeenCalledWith({
			name: "Desk_%",
			page: 2,
			pageSize: 50,
			sort: "createdAt:asc",
		});
		expect(result).toEqual({
			items: [
				{
					createdAt: "2026-07-14T01:00:00.000Z",
					description: "Desktop release",
					etag: 'W/"3"',
					id: PROGRAM_ID,
					name: "Desktop",
					updatedAt: "2026-07-14T02:00:00.000Z",
				},
			],
			page: 2,
			pageSize: 50,
			total: 1,
		});
	});

	it("rejects non-whitelisted pagination and sort values", async () => {
		const service = createProgramsService({ repository: repository() });

		await expect(
			service.list({
				page: 0,
				pageSize: 25,
				sort: "name:asc",
			} as never),
		).rejects.toMatchObject({
			fieldErrors: [{ path: "page" }, { path: "pageSize" }, { path: "sort" }],
		});
		await expect(
			service.list({
				page: PROGRAM_MAX_PAGE + 1,
				pageSize: 20,
				sort: "createdAt:desc",
			}),
		).rejects.toMatchObject({
			fieldErrors: [{ code: "INVALID_VALUE", path: "page" }],
		});
	});

	it("trims create fields, converts blank descriptions to null, and returns versionCount", async () => {
		const create = vi.fn(async () =>
			detail({
				description: null,
				name: "Desktop",
				rowVersion: 1n,
				versionCount: 0,
			}),
		);
		const service = createProgramsService({
			repository: repository({ create }),
		});

		const result = await service.create(
			{ description: "   ", name: "  Desktop  " },
			audit,
		);

		expect(create).toHaveBeenCalledWith({
			audit,
			description: null,
			name: "Desktop",
		});
		expect(result).toMatchObject({
			data: { description: null, name: "Desktop", versionCount: 0 },
			etag: 'W/"1"',
		});
	});

	it("validates normalized names and descriptions before repository work", async () => {
		const create = vi.fn(async () => detail());
		const service = createProgramsService({
			repository: repository({ create }),
		});

		await expect(service.create({ name: "   " }, audit)).rejects.toBeInstanceOf(
			ProgramsValidationError,
		);
		await expect(
			service.create({ name: "x".repeat(129) }, audit),
		).rejects.toMatchObject({
			fieldErrors: [{ code: "TOO_LONG", path: "name" }],
		});
		await expect(
			service.create({ description: "x".repeat(513), name: "Valid" }, audit),
		).rejects.toMatchObject({
			fieldErrors: [{ code: "TOO_LONG", path: "description" }],
		});
		for (const invalidName of ["bad\0name", "\ud800"]) {
			await expect(
				service.create({ name: invalidName }, audit),
			).rejects.toMatchObject({
				fieldErrors: [{ code: "INVALID_VALUE", path: "name" }],
			});
		}
		await expect(
			service.create({ description: "bad\0description", name: "Valid" }, audit),
		).rejects.toMatchObject({
			fieldErrors: [{ code: "INVALID_VALUE", path: "description" }],
		});
		await expect(
			service.list({
				name: "bad\0filter",
				page: 1,
				pageSize: 20,
				sort: "createdAt:desc",
			}),
		).rejects.toMatchObject({
			fieldErrors: [{ code: "INVALID_VALUE", path: "name" }],
		});
		expect(create).not.toHaveBeenCalled();
	});

	it("counts Unicode code points at the exact domain limits", async () => {
		const create = vi.fn(async () =>
			detail({
				description: "🧭".repeat(512),
				name: "🚀".repeat(128),
			}),
		);
		const service = createProgramsService({
			repository: repository({ create }),
		});

		await expect(
			service.create(
				{
					description: "🧭".repeat(512),
					name: "🚀".repeat(128),
				},
				audit,
			),
		).resolves.toBeDefined();
		await expect(
			service.create({ name: "🚀".repeat(129) }, audit),
		).rejects.toMatchObject({
			fieldErrors: [{ code: "TOO_LONG", path: "name" }],
		});
		await expect(
			service.create({ description: "🧭".repeat(513), name: "Valid" }, audit),
		).rejects.toMatchObject({
			fieldErrors: [{ code: "TOO_LONG", path: "description" }],
		});
		expect(create).toHaveBeenCalledOnce();
	});

	it("maps precise repository conflicts to a name field conflict", async () => {
		const service = createProgramsService({
			repository: repository({
				create: async () => {
					throw new ProgramNameConflictRepositoryError();
				},
			}),
		});

		await expect(service.create({ name: "Desktop" }, audit)).rejects.toEqual(
			expect.objectContaining({
				fieldErrors: [{ code: "NOT_UNIQUE", path: "name" }],
				name: ProgramNameConflictError.name,
			}),
		);
	});

	it("returns live detail counts and maps a missing program", async () => {
		const service = createProgramsService({ repository: repository() });
		await expect(service.getById(PROGRAM_ID)).resolves.toMatchObject({
			data: { id: PROGRAM_ID, versionCount: 4 },
			etag: 'W/"3"',
		});

		const missing = createProgramsService({
			repository: repository({ findById: async () => null }),
		});
		await expect(missing.getById(PROGRAM_ID)).rejects.toBeInstanceOf(
			ProgramNotFoundError,
		);
	});

	it("requires an exact weak ETag and a non-empty update", async () => {
		const update = vi.fn(async () => detail());
		const service = createProgramsService({
			repository: repository({ update }),
		});

		await expect(
			service.update(PROGRAM_ID, null, { name: "Next" }, audit),
		).rejects.toBeInstanceOf(ProgramPreconditionRequiredError);
		for (const stale of [
			'"3"',
			"*",
			'W/"03"',
			'W/"3", W/"2"',
			'W/"9223372036854775808"',
			'W/"999999999999999999999999999"',
		]) {
			await expect(
				service.update(PROGRAM_ID, stale, { name: "Next" }, audit),
			).rejects.toBeInstanceOf(ProgramStaleWriteError);
		}
		await expect(
			service.update(PROGRAM_ID, 'W/"3"', {} as UpdateProgramInput, audit),
		).rejects.toMatchObject({
			fieldErrors: [{ code: "AT_LEAST_ONE_REQUIRED", path: "$" }],
		});
		expect(update).not.toHaveBeenCalled();
	});

	it("passes atomic row versions and returns the transaction's live version count", async () => {
		const update = vi.fn(async () =>
			detail({
				description: null,
				name: "Next",
				rowVersion: 4n,
				versionCount: 7,
			}),
		);
		const service = createProgramsService({
			now: () => NOW,
			repository: repository({ update }),
		});

		const result = await service.update(
			PROGRAM_ID,
			'W/"3"',
			{ description: "   ", name: "  Next " },
			audit,
		);

		expect(update).toHaveBeenCalledWith({
			audit,
			description: null,
			expectedRowVersion: 3n,
			id: PROGRAM_ID,
			name: "Next",
			now: NOW,
		});
		expect(result).toMatchObject({
			data: { versionCount: 7 },
			etag: 'W/"4"',
		});
	});

	it("maps not-found, stale, and conflict update repository outcomes", async () => {
		for (const [repositoryError, domainError] of [
			[new ProgramNotFoundRepositoryError(), ProgramNotFoundError],
			[new ProgramStaleWriteRepositoryError(), ProgramStaleWriteError],
			[new ProgramNameConflictRepositoryError(), ProgramNameConflictError],
		] as const) {
			const service = createProgramsService({
				repository: repository({
					update: async () => {
						throw repositoryError;
					},
				}),
			});
			await expect(
				service.update(PROGRAM_ID, 'W/"3"', { name: "Next" }, audit),
			).rejects.toBeInstanceOf(domainError);
		}
	});

	it("deletes with the parsed row version and returns the affected version count", async () => {
		const remove = vi.fn(async () => ({ affectedVersionCount: 6 }));
		const service = createProgramsService({
			now: () => NOW,
			repository: repository({ delete: remove }),
		});

		await expect(service.delete(PROGRAM_ID, 'W/"3"', audit)).resolves.toEqual({
			affectedVersionCount: 6,
		});
		expect(remove).toHaveBeenCalledWith({
			audit,
			expectedRowVersion: 3n,
			id: PROGRAM_ID,
			now: NOW,
		});
	});
});
