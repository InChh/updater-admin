import { Elysia } from "elysia";
import { describe, expect, it, vi } from "vitest";

import type { ApiProblem, EntityResult } from "../../../shared/api/common";
import type {
	ProgramDetailDto,
	ProgramPage,
} from "../../../shared/api/programs";
import { PROGRAM_MAX_PAGE } from "../../../shared/api/programs";
import type { SafeSessionView } from "../../auth/session.server";
import {
	ProgramNameConflictError,
	ProgramNotFoundError,
	ProgramPreconditionRequiredError,
	ProgramStaleWriteError,
	type ProgramsService,
	ProgramsValidationError,
} from "../../domain/programs.server";
import { ApiRequestContextStore } from "../context.server";
import { mapApiError } from "../problem";
import { createProgramsModule } from "./programs";

const PROGRAM_ID = "00000000-0000-4000-8000-000000000010";
const ACTOR_ID = "00000000-0000-4000-8000-000000000001";
const detail: ProgramDetailDto = {
	createdAt: "2026-07-14T01:00:00.000Z",
	description: "Desktop",
	id: PROGRAM_ID,
	name: "Desktop",
	updatedAt: "2026-07-14T02:00:00.000Z",
	versionCount: 3,
};
const entity: EntityResult<ProgramDetailDto> = {
	data: detail,
	etag: 'W/"3"',
};
const page: ProgramPage = {
	items: [
		{
			createdAt: detail.createdAt,
			description: detail.description,
			etag: 'W/"3"',
			id: detail.id,
			name: detail.name,
			updatedAt: detail.updatedAt,
		},
	],
	page: 1,
	pageSize: 20,
	total: 1,
};

function service(overrides: Partial<ProgramsService> = {}): ProgramsService {
	return {
		create: vi.fn(async () => entity),
		delete: vi.fn(async () => ({ affectedVersionCount: 3 })),
		getById: vi.fn(async () => entity),
		list: vi.fn(async () => page),
		update: vi.fn(async () => ({ ...entity, etag: 'W/"4"' as const })),
		...overrides,
	};
}

function testApp(
	programsService: ProgramsService,
	options: { readonly audit?: boolean; readonly session?: boolean } = {},
) {
	const contextStore = new ApiRequestContextStore();
	const getProgramsService = vi.fn(() => programsService);
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
		.use(createProgramsModule({ contextStore, getProgramsService }));
	return { app, getProgramsService };
}

async function readProblem(response: Response): Promise<ApiProblem> {
	expect(response.headers.get("content-type")).toBe("application/problem+json");
	return (await response.json()) as ApiProblem;
}

describe("programs Elysia module", () => {
	it("does not resolve its service during module construction", () => {
		const { getProgramsService } = testApp(service());
		expect(getProgramsService).not.toHaveBeenCalled();
	});

	it("lists with strict defaults and coerced whitelisted query values", async () => {
		const list = vi.fn(async () => page);
		const { app } = testApp(service({ list }));

		const defaults = await app.handle(new Request("http://localhost/programs"));
		expect(defaults.status).toBe(200);
		expect(await defaults.json()).toEqual(page);
		expect(list).toHaveBeenNthCalledWith(1, {
			page: 1,
			pageSize: 20,
			sort: "createdAt:desc",
		});

		const filtered = await app.handle(
			new Request(
				"http://localhost/programs?name=Desk_%25&page=2&pageSize=50&sort=createdAt%3Aasc",
			),
		);
		expect(filtered.status).toBe(200);
		expect(list).toHaveBeenNthCalledWith(2, {
			name: "Desk_%",
			page: 2,
			pageSize: 50,
			sort: "createdAt:asc",
		});

		const outOfRange = await app.handle(
			new Request(`http://localhost/programs?page=${PROGRAM_MAX_PAGE + 1}`),
		);
		expect(outOfRange.status).toBe(422);
		expect(list).toHaveBeenCalledTimes(2);
	});

	it("returns 201 with canonical Location and ETag on create", async () => {
		const create = vi.fn(async () => entity);
		const { app } = testApp(service({ create }));
		const response = await app.handle(
			new Request("http://localhost/programs", {
				body: JSON.stringify({ description: "Desktop", name: "Desktop" }),
				headers: { "content-type": "application/json" },
				method: "POST",
			}),
		);

		expect(response.status).toBe(201);
		expect(response.headers.get("etag")).toBe('W/"3"');
		expect(response.headers.get("location")).toBe(
			`/api/v1/programs/${PROGRAM_ID}`,
		);
		expect(await response.json()).toEqual(detail);
		expect(create).toHaveBeenCalledWith(
			{ description: "Desktop", name: "Desktop" },
			expect.objectContaining({ actorId: ACTOR_ID, requestId: "req_test" }),
		);
	});

	it("admits domain-valid non-BMP values through request and response schemas", async () => {
		const unicodeDetail: ProgramDetailDto = {
			...detail,
			description: "🧭".repeat(512),
			name: "🚀".repeat(128),
		};
		const unicodeEntity: EntityResult<ProgramDetailDto> = {
			data: unicodeDetail,
			etag: 'W/"3"',
		};
		const create = vi.fn(async () => unicodeEntity);
		const getById = vi.fn(async () => unicodeEntity);
		const { app } = testApp(service({ create, getById }));

		const created = await app.handle(
			new Request("http://localhost/programs", {
				body: JSON.stringify({
					description: unicodeDetail.description,
					name: unicodeDetail.name,
				}),
				headers: { "content-type": "application/json" },
				method: "POST",
			}),
		);
		const found = await app.handle(
			new Request(`http://localhost/programs/${PROGRAM_ID}`),
		);

		expect(created.status).toBe(201);
		expect(found.status).toBe(200);
		expect(await found.json()).toEqual(unicodeDetail);
		expect(create).toHaveBeenCalledWith(
			{
				description: unicodeDetail.description,
				name: unicodeDetail.name,
			},
			expect.anything(),
		);
	});

	it("returns detail and mutation ETags and forwards exact X-Updater-If-Match", async () => {
		const getById = vi.fn(async () => entity);
		const update = vi.fn(async () => ({ ...entity, etag: 'W/"4"' as const }));
		const { app } = testApp(service({ getById, update }));

		const found = await app.handle(
			new Request(`http://localhost/programs/${PROGRAM_ID}`),
		);
		expect(found.status).toBe(200);
		expect(found.headers.get("etag")).toBe('W/"3"');
		expect(await found.json()).toEqual(detail);

		const changed = await app.handle(
			new Request(`http://localhost/programs/${PROGRAM_ID}`, {
				body: JSON.stringify({ name: "Desktop Next" }),
				headers: {
					"content-type": "application/json",
					"x-updater-if-match": 'W/"3"',
				},
				method: "PATCH",
			}),
		);
		expect(changed.status).toBe(200);
		expect(changed.headers.get("etag")).toBe('W/"4"');
		expect(update).toHaveBeenCalledWith(
			PROGRAM_ID,
			'W/"3"',
			{ name: "Desktop Next" },
			expect.objectContaining({ actorId: ACTOR_ID }),
		);
	});

	it("ignores standard If-Match and rejects the mutation before service work", async () => {
		const update = vi.fn(async () => ({ ...entity, etag: 'W/"4"' as const }));
		const { app } = testApp(service({ update }));
		const response = await app.handle(
			new Request(`http://localhost/programs/${PROGRAM_ID}`, {
				body: JSON.stringify({ name: "Desktop Next" }),
				headers: {
					"content-type": "application/json",
					"if-match": 'W/"3"',
				},
				method: "PATCH",
			}),
		);

		expect(response.status).toBe(428);
		expect(await readProblem(response)).toMatchObject({
			code: "PRECONDITION_REQUIRED",
			status: 428,
		});
		expect(update).not.toHaveBeenCalled();
	});

	it("deletes with exact X-Updater-If-Match and an empty 204 body", async () => {
		const remove = vi.fn(async () => ({ affectedVersionCount: 3 }));
		const { app } = testApp(service({ delete: remove }));
		const response = await app.handle(
			new Request(`http://localhost/programs/${PROGRAM_ID}`, {
				headers: { "x-updater-if-match": 'W/"3"' },
				method: "DELETE",
			}),
		);

		expect(response.status).toBe(204);
		expect(await response.text()).toBe("");
		expect(remove).toHaveBeenCalledWith(
			PROGRAM_ID,
			'W/"3"',
			expect.objectContaining({ actorId: ACTOR_ID }),
		);
	});

	it("maps domain not-found, precondition, stale, conflict, and validation errors", async () => {
		const cases = [
			{
				code: "NOT_FOUND",
				error: new ProgramNotFoundError(),
				status: 404,
			},
			{
				code: "PRECONDITION_REQUIRED",
				error: new ProgramPreconditionRequiredError(),
				status: 428,
			},
			{
				code: "STALE_WRITE",
				error: new ProgramStaleWriteError(),
				status: 409,
			},
			{
				code: "PROGRAM_NAME_CONFLICT",
				error: new ProgramNameConflictError(),
				fieldErrors: [{ code: "NOT_UNIQUE", path: "name" }],
				status: 409,
			},
			{
				code: "VALIDATION_FAILED",
				error: new ProgramsValidationError([
					{ code: "TOO_LONG", path: "description" },
				]),
				fieldErrors: [{ code: "TOO_LONG", path: "description" }],
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
				new Request(`http://localhost/programs/${PROGRAM_ID}`),
			);
			const problem = await readProblem(response);
			expect(response.status).toBe(testCase.status);
			expect(problem).toMatchObject({
				code: testCase.code,
				...("fieldErrors" in testCase
					? { fieldErrors: testCase.fieldErrors }
					: {}),
				requestId: "req_test",
			});
		}
	});

	it("uses strict request schemas and rejects an empty PATCH", async () => {
		const programsService = service();
		const { app, getProgramsService } = testApp(programsService);
		const extra = await app.handle(
			new Request("http://localhost/programs", {
				body: JSON.stringify({ extra: true, name: "Desktop" }),
				headers: { "content-type": "application/json" },
				method: "POST",
			}),
		);
		const emptyPatch = await app.handle(
			new Request(`http://localhost/programs/${PROGRAM_ID}`, {
				body: "{}",
				headers: { "content-type": "application/json" },
				method: "PATCH",
			}),
		);

		expect(extra.status).toBe(422);
		expect(emptyPatch.status).toBe(422);
		expect(getProgramsService).not.toHaveBeenCalled();
	});

	it("requires session and audit context before resolving the service", async () => {
		const missingSession = testApp(service(), { session: false });
		const read = await missingSession.app.handle(
			new Request("http://localhost/programs"),
		);
		expect(read.status).toBe(500);
		expect(missingSession.getProgramsService).not.toHaveBeenCalled();

		const missingAudit = testApp(service(), { audit: false });
		const write = await missingAudit.app.handle(
			new Request("http://localhost/programs", {
				body: JSON.stringify({ name: "Desktop" }),
				headers: { "content-type": "application/json" },
				method: "POST",
			}),
		);
		expect(write.status).toBe(500);
		expect(missingAudit.getProgramsService).not.toHaveBeenCalled();
	});
});
