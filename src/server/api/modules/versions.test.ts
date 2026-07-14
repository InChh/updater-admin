import { Elysia } from "elysia";
import { describe, expect, it, vi } from "vitest";

import type { ApiProblem, EntityResult } from "../../../shared/api/common";
import type { FilePage } from "../../../shared/api/files";
import type {
	VersionDetailDto,
	VersionPage,
} from "../../../shared/api/versions";
import type { SafeSessionView } from "../../auth/session.server";
import { ProgramNotFoundError } from "../../domain/programs.server";
import {
	VersionNotFoundError,
	VersionNotGreaterError,
	VersionNumberConflictError,
	VersionPreconditionRequiredError,
	VersionStaleWriteError,
	type VersionsService,
	VersionsValidationError,
} from "../../domain/versions.server";
import { ApiRequestContextStore } from "../context.server";
import { mapApiError } from "../problem";
import { createVersionsModule } from "./versions";

const PROGRAM_ID = "00000000-0000-4000-8000-000000000010";
const VERSION_ID = "00000000-0000-4000-8000-000000000020";
const FILE_ID = "00000000-0000-4000-8000-000000000030";
const ACTOR_ID = "00000000-0000-4000-8000-000000000001";

const detail: VersionDetailDto = {
	createdAt: "2026-07-14T01:00:00.000Z",
	description: "Desktop build",
	fileCount: 1,
	fileIds: [FILE_ID],
	id: VERSION_ID,
	isActive: true,
	isLatest: true,
	programId: PROGRAM_ID,
	updatedAt: "2026-07-14T02:00:00.000Z",
	versionNumber: "1.10.0",
};

const entity: EntityResult<VersionDetailDto> = {
	data: detail,
	etag: 'W/"3"',
};

const page: VersionPage = {
	items: [
		{
			createdAt: detail.createdAt,
			description: detail.description,
			etag: 'W/"3"',
			fileCount: detail.fileCount,
			id: detail.id,
			isActive: detail.isActive,
			isLatest: detail.isLatest,
			programId: detail.programId,
			updatedAt: detail.updatedAt,
			versionNumber: detail.versionNumber,
		},
	],
	page: 1,
	pageSize: 20,
	total: 1,
};

const filePage: FilePage = {
	items: [
		{
			checksumAlgorithm: "sha256",
			createdAt: "2026-07-14T01:00:00.000Z",
			id: FILE_ID,
			mimeType: "application/octet-stream",
			objectEtag: null,
			path: "release/app.bin",
			sha256: "a".repeat(64),
			size: "42",
			updatedAt: "2026-07-14T02:00:00.000Z",
		},
	],
	page: 1,
	pageSize: 20,
	total: 1,
};

function service(overrides: Partial<VersionsService> = {}): VersionsService {
	return {
		create: vi.fn(async () => entity),
		delete: vi.fn(async () => {}),
		getById: vi.fn(async () => entity),
		list: vi.fn(async () => page),
		listFiles: vi.fn(async () => filePage),
		setActivation: vi.fn(async () => ({ ...entity, etag: 'W/"4"' as const })),
		update: vi.fn(async () => ({ ...entity, etag: 'W/"4"' as const })),
		...overrides,
	};
}

function testApp(
	versionsService: VersionsService,
	options: { readonly audit?: boolean; readonly session?: boolean } = {},
) {
	const contextStore = new ApiRequestContextStore();
	const getVersionsService = vi.fn(() => versionsService);
	const app = new Elysia({ normalize: false })
		.onError((context) =>
			mapApiError(context, {
				getRequestId: (request) =>
					contextStore.getRequestId(request) ?? "req_fallback",
			}),
		)
		.onRequest(({ request }) => {
			contextStore.initialize(request, "req_test");
			if (options.session !== false) {
				contextStore.setSession(request, {} as SafeSessionView);
			}
			if (options.audit !== false) {
				contextStore.setAudit(request, {
					actorId: ACTOR_ID,
					ip: "203.0.113.8",
					requestId: "req_test",
					userAgent: "test",
				});
			}
		})
		.use(createVersionsModule({ contextStore, getVersionsService }));
	return { app, getVersionsService };
}

async function readProblem(response: Response): Promise<ApiProblem> {
	expect(response.headers.get("content-type")).toBe("application/problem+json");
	return (await response.json()) as ApiProblem;
}

describe("versions Elysia module", () => {
	it("keeps service creation lazy and lists with strict defaults", async () => {
		const list = vi.fn(async () => page);
		const { app, getVersionsService } = testApp(service({ list }));
		expect(getVersionsService).not.toHaveBeenCalled();

		const defaults = await app.handle(
			new Request(`http://localhost/programs/${PROGRAM_ID}/versions`),
		);
		expect(defaults.status).toBe(200);
		expect(await defaults.json()).toEqual(page);
		expect(list).toHaveBeenNthCalledWith(1, PROGRAM_ID, {
			page: 1,
			pageSize: 20,
			sort: "createdAt:desc",
		});

		const filtered = await app.handle(
			new Request(
				`http://localhost/programs/${PROGRAM_ID}/versions?page=2&pageSize=50&sort=createdAt%3Aasc`,
			),
		);
		expect(filtered.status).toBe(200);
		expect(list).toHaveBeenNthCalledWith(2, PROGRAM_ID, {
			page: 2,
			pageSize: 50,
			sort: "createdAt:asc",
		});
	});

	it("creates with 201, canonical Location, and an ETag", async () => {
		const create = vi.fn(async () => entity);
		const { app } = testApp(service({ create }));
		const response = await app.handle(
			new Request(`http://localhost/programs/${PROGRAM_ID}/versions`, {
				body: JSON.stringify({
					description: "Desktop build",
					fileIds: [FILE_ID],
					versionNumber: "1.10.0",
				}),
				headers: { "content-type": "application/json" },
				method: "POST",
			}),
		);

		expect(response.status).toBe(201);
		expect(response.headers.get("etag")).toBe('W/"3"');
		expect(response.headers.get("location")).toBe(
			`/api/v1/programs/${PROGRAM_ID}/versions/${VERSION_ID}`,
		);
		expect(await response.json()).toEqual(detail);
		expect(create).toHaveBeenCalledWith(
			PROGRAM_ID,
			{
				description: "Desktop build",
				fileIds: [FILE_ID],
				versionNumber: "1.10.0",
			},
			expect.objectContaining({ actorId: ACTOR_ID }),
		);
	});

	it("returns detail and mutation ETags and forwards exact If-Match", async () => {
		const getById = vi.fn(async () => entity);
		const update = vi.fn(async () => ({ ...entity, etag: 'W/"4"' as const }));
		const setActivation = vi.fn(async () => ({
			...entity,
			etag: 'W/"5"' as const,
		}));
		const { app } = testApp(service({ getById, setActivation, update }));

		const found = await app.handle(
			new Request(
				`http://localhost/programs/${PROGRAM_ID}/versions/${VERSION_ID}`,
			),
		);
		expect(found.status).toBe(200);
		expect(found.headers.get("etag")).toBe('W/"3"');

		const changed = await app.handle(
			new Request(
				`http://localhost/programs/${PROGRAM_ID}/versions/${VERSION_ID}`,
				{
					body: JSON.stringify({ fileIds: [], versionNumber: "2.0.0" }),
					headers: {
						"content-type": "application/json",
						"if-match": 'W/"3"',
					},
					method: "PATCH",
				},
			),
		);
		expect(changed.status).toBe(200);
		expect(changed.headers.get("etag")).toBe('W/"4"');
		expect(update).toHaveBeenCalledWith(
			PROGRAM_ID,
			VERSION_ID,
			'W/"3"',
			{ fileIds: [], versionNumber: "2.0.0" },
			expect.objectContaining({ actorId: ACTOR_ID }),
		);

		const activated = await app.handle(
			new Request(
				`http://localhost/programs/${PROGRAM_ID}/versions/${VERSION_ID}/activation`,
				{
					body: JSON.stringify({ isActive: false }),
					headers: {
						"content-type": "application/json",
						"if-match": 'W/"4"',
					},
					method: "PUT",
				},
			),
		);
		expect(activated.status).toBe(200);
		expect(activated.headers.get("etag")).toBe('W/"5"');
		expect(setActivation).toHaveBeenCalledWith(
			PROGRAM_ID,
			VERSION_ID,
			'W/"4"',
			{ isActive: false },
			expect.objectContaining({ actorId: ACTOR_ID }),
		);
	});

	it("deletes with exact If-Match and an empty 204 body", async () => {
		const remove = vi.fn(async () => {});
		const { app } = testApp(service({ delete: remove }));
		const response = await app.handle(
			new Request(
				`http://localhost/programs/${PROGRAM_ID}/versions/${VERSION_ID}`,
				{ headers: { "if-match": 'W/"3"' }, method: "DELETE" },
			),
		);

		expect(response.status).toBe(204);
		expect(await response.text()).toBe("");
		expect(remove).toHaveBeenCalledWith(
			PROGRAM_ID,
			VERSION_ID,
			'W/"3"',
			expect.objectContaining({ actorId: ACTOR_ID }),
		);
	});

	it("lists nested files with path sort defaults", async () => {
		const listFiles = vi.fn(async () => filePage);
		const { app } = testApp(service({ listFiles }));
		const response = await app.handle(
			new Request(
				`http://localhost/programs/${PROGRAM_ID}/versions/${VERSION_ID}/files`,
			),
		);

		expect(response.status).toBe(200);
		expect(await response.json()).toEqual(filePage);
		expect(listFiles).toHaveBeenCalledWith(PROGRAM_ID, VERSION_ID, {
			page: 1,
			pageSize: 20,
			sort: "path:asc",
		});
	});

	it("maps domain failures to the compact problem contract", async () => {
		const cases = [
			{ code: "NOT_FOUND", error: new ProgramNotFoundError(), status: 404 },
			{ code: "NOT_FOUND", error: new VersionNotFoundError(), status: 404 },
			{
				code: "PRECONDITION_REQUIRED",
				error: new VersionPreconditionRequiredError(),
				status: 428,
			},
			{
				code: "STALE_WRITE",
				error: new VersionStaleWriteError(),
				status: 409,
			},
			{
				code: "VERSION_NUMBER_CONFLICT",
				error: new VersionNumberConflictError(),
				status: 409,
			},
			{
				code: "VERSION_NOT_GREATER",
				error: new VersionNotGreaterError("1.9.99"),
				status: 409,
			},
			{
				code: "VALIDATION_FAILED",
				error: new VersionsValidationError([
					{ code: "NOT_FOUND", path: "fileIds" },
				]),
				status: 422,
			},
		] as const;

		for (const testCase of cases) {
			const { app } = testApp(
				service({
					getById: async () => {
						throw testCase.error;
					},
				}),
			);
			const response = await app.handle(
				new Request(
					`http://localhost/programs/${PROGRAM_ID}/versions/${VERSION_ID}`,
				),
			);
			const problem = await readProblem(response);
			expect(response.status).toBe(testCase.status);
			expect(problem).toMatchObject({
				code: testCase.code,
				requestId: "req_test",
			});
		}
	});

	it("rejects extra fields, empty updates, empty creates, and oversized file sets", async () => {
		const { app, getVersionsService } = testApp(service());
		const requests = [
			new Request(`http://localhost/programs/${PROGRAM_ID}/versions`, {
				body: JSON.stringify({ fileIds: [], versionNumber: "1.0.0" }),
				headers: { "content-type": "application/json" },
				method: "POST",
			}),
			new Request(
				`http://localhost/programs/${PROGRAM_ID}/versions/${VERSION_ID}`,
				{
					body: "{}",
					headers: { "content-type": "application/json" },
					method: "PATCH",
				},
			),
			new Request(
				`http://localhost/programs/${PROGRAM_ID}/versions/${VERSION_ID}/activation`,
				{
					body: JSON.stringify({ extra: true, isActive: true }),
					headers: { "content-type": "application/json" },
					method: "PUT",
				},
			),
			new Request(`http://localhost/programs/${PROGRAM_ID}/versions`, {
				body: JSON.stringify({
					fileIds: Array.from({ length: 10_001 }, () => FILE_ID),
					versionNumber: "1.0.0",
				}),
				headers: { "content-type": "application/json" },
				method: "POST",
			}),
		];

		for (const request of requests) {
			const response = await app.handle(request);
			expect(response.status).toBe(422);
		}
		expect(getVersionsService).not.toHaveBeenCalled();
	});

	it("requires session and audit context before resolving the service", async () => {
		const missingSession = testApp(service(), { session: false });
		const read = await missingSession.app.handle(
			new Request(`http://localhost/programs/${PROGRAM_ID}/versions`),
		);
		expect(read.status).toBe(500);
		expect(missingSession.getVersionsService).not.toHaveBeenCalled();

		const missingAudit = testApp(service(), { audit: false });
		const write = await missingAudit.app.handle(
			new Request(`http://localhost/programs/${PROGRAM_ID}/versions`, {
				body: JSON.stringify({ fileIds: [FILE_ID], versionNumber: "1.0.0" }),
				headers: { "content-type": "application/json" },
				method: "POST",
			}),
		);
		expect(write.status).toBe(500);
		expect(missingAudit.getVersionsService).not.toHaveBeenCalled();
	});
});
