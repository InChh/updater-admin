import { describe, expect, it, vi } from "vitest";

import { AdministratorCredentialError } from "../auth/administrator-credentials.server";
import {
	type AdministratorMutationContext,
	AdministratorSelfDisableRepositoryError,
	AdministratorStaleWriteRepositoryError,
	type AdministratorsRepository,
	LastActiveAdministratorRepositoryError,
} from "../db/repositories/administrators.server";
import {
	AdministratorEmailConflictError,
	AdministratorPreconditionRequiredError,
	AdministratorSelfDisableError,
	AdministratorStaleWriteError,
	createAdministratorsService,
	LastActiveAdministratorError,
} from "./administrators.server";

const ACTOR_ID = "00000000-0000-4000-8000-000000000001";
const TARGET_ID = "00000000-0000-4000-8000-000000000002";
const TEMPORARY_PASSWORD = "Temporary!Admin-2026#Safe";
const audit: AdministratorMutationContext = {
	actorId: ACTOR_ID,
	ip: "203.0.113.8",
	requestId: "req_test",
	userAgent: "test",
};

function record(overrides: Record<string, unknown> = {}) {
	return {
		banned: false,
		createdAt: new Date("2026-07-14T00:00:00.000Z"),
		email: "target@example.com",
		id: TARGET_ID,
		lastLoginAt: null,
		locale: "zh-CN" as const,
		mustChangePassword: true,
		name: "Target",
		rowVersion: 3n,
		updatedAt: new Date("2026-07-14T00:00:00.000Z"),
		...overrides,
	};
}

function repository(
	overrides: Partial<AdministratorsRepository> = {},
): AdministratorsRepository {
	return {
		findById: vi.fn(async () => record()),
		list: vi.fn(async () => ({ items: [record()], total: 1 })),
		revokeSessions: vi.fn(async () => {}),
		update: vi.fn(async () => record()),
		...overrides,
	};
}

describe("administrators service", () => {
	it("normalizes pagination/search and returns only the safe administrator projection", async () => {
		const repo = repository();
		const service = createAdministratorsService({ repository: repo });

		const page = await service.list({
			page: 2,
			pageSize: 50,
			query: "  Target  ",
			sort: "name:asc",
			status: "active",
		});

		expect(repo.list).toHaveBeenCalledWith({
			page: 2,
			pageSize: 50,
			query: "Target",
			sort: "name:asc",
			status: "active",
		});
		expect(page.items).toEqual([
			expect.objectContaining({
				email: "target@example.com",
				enabled: true,
				etag: 'W/"3"',
				id: TARGET_ID,
			}),
		]);
		expect(JSON.stringify(page)).not.toMatch(
			/temporaryPassword|passwordHash|sessionToken|cookie/i,
		);
	});

	it("creates a fixed-policy temporary-password administrator and reloads its safe record", async () => {
		const repo = repository();
		const createCredential = vi.fn(async () => ({ userId: TARGET_ID }));
		const service = createAdministratorsService({
			createCredential,
			repository: repo,
		});
		const headers = new Headers({ cookie: "server-only" });

		await expect(
			service.create(
				{
					email: " New.Admin@Example.com ",
					name: " New Administrator ",
					temporaryPassword: TEMPORARY_PASSWORD,
				},
				headers,
				audit,
			),
		).resolves.toMatchObject({ id: TARGET_ID, mustChangePassword: true });
		expect(createCredential).toHaveBeenCalledWith({
			audit,
			email: "new.admin@example.com",
			headers,
			name: "New Administrator",
			temporaryPassword: TEMPORARY_PASSWORD,
		});
	});

	it("maps a duplicate credential email without exposing the temporary password", async () => {
		const service = createAdministratorsService({
			createCredential: async () => {
				throw new AdministratorCredentialError(
					"ADMINISTRATOR_EMAIL_CONFLICT",
					"An administrator already uses this email address.",
				);
			},
			repository: repository(),
		});

		const error = await service
			.create(
				{
					email: "target@example.com",
					name: "Target",
					temporaryPassword: TEMPORARY_PASSWORD,
				},
				new Headers(),
				audit,
			)
			.catch((cause: unknown) => cause);
		expect(error).toBeInstanceOf(AdministratorEmailConflictError);
		expect(String(error)).not.toContain(TEMPORARY_PASSWORD);
	});

	it("rejects self-disable before repository mutation and maps locked last-admin protection", async () => {
		const update = vi.fn(async () => record());
		const service = createAdministratorsService({
			repository: repository({ update }),
		});
		await expect(
			service.update(
				ACTOR_ID,
				'W/"3"',
				{ enabled: false },
				new Headers(),
				audit,
			),
		).rejects.toBeInstanceOf(AdministratorSelfDisableError);
		expect(update).not.toHaveBeenCalled();

		const lockedService = createAdministratorsService({
			repository: repository({
				update: async () => {
					throw new LastActiveAdministratorRepositoryError();
				},
			}),
		});
		await expect(
			lockedService.update(
				TARGET_ID,
				'W/"3"',
				{ enabled: false },
				new Headers(),
				audit,
			),
		).rejects.toBeInstanceOf(LastActiveAdministratorError);
	});

	it("maps the repository's defense-in-depth self-disable rejection", async () => {
		const service = createAdministratorsService({
			repository: repository({
				update: async () => {
					throw new AdministratorSelfDisableRepositoryError();
				},
			}),
		});
		await expect(
			service.update(TARGET_ID, 'W/"3"', { enabled: false }, new Headers(), {
				...audit,
				actorId: "00000000-0000-4000-8000-000000000003",
			}),
		).rejects.toBeInstanceOf(AdministratorSelfDisableError);
	});

	it("requires an exact current row version and maps repository races", async () => {
		const service = createAdministratorsService({ repository: repository() });
		await expect(
			service.update(
				TARGET_ID,
				null,
				{ name: "Changed" },
				new Headers(),
				audit,
			),
		).rejects.toBeInstanceOf(AdministratorPreconditionRequiredError);
		await expect(
			service.update(
				TARGET_ID,
				'W/"03"',
				{ name: "Changed" },
				new Headers(),
				audit,
			),
		).rejects.toBeInstanceOf(AdministratorStaleWriteError);

		const update = vi.fn(async () => {
			throw new AdministratorStaleWriteRepositoryError();
		});
		const racingService = createAdministratorsService({
			repository: repository({ update }),
		});
		await expect(
			racingService.update(
				TARGET_ID,
				'W/"3"',
				{ name: "Changed" },
				new Headers(),
				audit,
			),
		).rejects.toBeInstanceOf(AdministratorStaleWriteError);
		expect(update).toHaveBeenCalledWith(
			expect.objectContaining({ expectedRowVersion: 3n, id: TARGET_ID }),
		);
	});

	it("resets a temporary password with revocation and supports explicit session revocation", async () => {
		const repo = repository();
		const resetCredential = vi.fn(async () => ({ userId: TARGET_ID }));
		const service = createAdministratorsService({
			repository: repo,
			resetCredential,
		});
		const headers = new Headers({ cookie: "server-only" });

		await service.resetPassword(
			TARGET_ID,
			{ temporaryPassword: TEMPORARY_PASSWORD },
			headers,
			audit,
		);
		expect(resetCredential).toHaveBeenCalledWith({
			audit,
			headers,
			temporaryPassword: TEMPORARY_PASSWORD,
			userId: TARGET_ID,
		});

		await expect(
			service.revokeSessions(TARGET_ID, headers, audit),
		).resolves.toEqual({ success: true });
		expect(repo.revokeSessions).toHaveBeenCalledWith({
			audit,
			headers,
			id: TARGET_ID,
		});
	});
});
