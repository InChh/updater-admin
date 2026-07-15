import { Elysia } from "elysia";
import { describe, expect, it, vi } from "vitest";
import type {
	AuditEventDetailDto,
	AuditEventPage,
} from "../../../shared/api/audit";
import type { ApiProblem } from "../../../shared/api/common";
import type { SafeSessionView } from "../../auth/session.server";
import {
	AuditEventNotFoundError,
	type AuditService,
	AuditValidationError,
} from "../../domain/audit.server";
import { ApiRequestContextStore } from "../context.server";
import { mapApiError } from "../problem";
import { createAuditModule } from "./audit";

const EVENT_ID = "00000000-0000-4000-8000-000000000010";
const ACTOR_ID = "00000000-0000-4000-8000-000000000001";
const item = {
	action: "program.updated",
	actorId: ACTOR_ID,
	createdAt: "2026-07-14T12:00:00.000Z",
	id: EVENT_ID,
	resourceId: "00000000-0000-4000-8000-000000000020",
	resourceType: "program",
	result: "success" as const,
};
const page: AuditEventPage = {
	items: [item],
	page: 1,
	pageSize: 20,
	total: 1,
};
const detail: AuditEventDetailDto = {
	...item,
	after: { name: "After" },
	before: { name: "Before" },
	ip: "203.0.113.8",
	requestId: "req_audit",
	userAgent: "test",
};

function service(overrides: Partial<AuditService> = {}): AuditService {
	return {
		getById: vi.fn(async () => detail),
		list: vi.fn(async () => page),
		...overrides,
	};
}

function testApp(
	auditService: AuditService,
	options: { readonly session?: boolean } = {},
) {
	const contextStore = new ApiRequestContextStore();
	const getAuditService = vi.fn(() => auditService);
	const app = new Elysia({ normalize: false })
		.onError((context) =>
			mapApiError(context, {
				getRequestId: (request) =>
					contextStore.getRequestId(request) ?? "req_fallback",
			}),
		)
		.onRequest(({ request }) => {
			contextStore.initialize(request, "req_audit");
			if (options.session !== false) {
				contextStore.setSession(request, {} as SafeSessionView);
			}
		})
		.use(createAuditModule({ contextStore, getAuditService }));
	return { app, getAuditService };
}

async function readProblem(response: Response): Promise<ApiProblem> {
	expect(response.headers.get("content-type")).toBe("application/problem+json");
	return (await response.json()) as ApiProblem;
}

describe("audit Elysia module", () => {
	it("keeps service construction lazy and forwards strict list defaults", async () => {
		const list = vi.fn(async () => page);
		const { app, getAuditService } = testApp(service({ list }));
		expect(getAuditService).not.toHaveBeenCalled();

		const response = await app.handle(
			new Request("http://localhost/audit-events"),
		);
		expect(response.status).toBe(200);
		expect(await response.json()).toEqual(page);
		expect(list).toHaveBeenCalledWith({
			page: 1,
			pageSize: 20,
			sort: "createdAt:desc",
		});
	});

	it("forwards all whitelisted filters and returns detail JSON", async () => {
		const list = vi.fn(async () => ({
			...page,
			page: 2,
			pageSize: 50 as const,
		}));
		const getById = vi.fn(async () => detail);
		const { app } = testApp(service({ getById, list }));
		const listResponse = await app.handle(
			new Request(
				`http://localhost/audit-events?action=program.updated&actorId=${ACTOR_ID}&from=2026-07-01&page=2&pageSize=50&resourceType=program&result=success&sort=createdAt%3Aasc&to=2026-07-14`,
			),
		);
		expect(listResponse.status).toBe(200);
		expect(list).toHaveBeenCalledWith({
			action: "program.updated",
			actorId: ACTOR_ID,
			from: "2026-07-01",
			page: 2,
			pageSize: 50,
			resourceType: "program",
			result: "success",
			sort: "createdAt:asc",
			to: "2026-07-14",
		});

		const detailResponse = await app.handle(
			new Request(`http://localhost/audit-events/${EVENT_ID}`),
		);
		expect(detailResponse.status).toBe(200);
		expect(await detailResponse.json()).toEqual(detail);
		expect(getById).toHaveBeenCalledWith(EVENT_ID);
	});

	it("rejects non-whitelisted and malformed query values before service work", async () => {
		const invalidUrls = [
			"http://localhost/audit-events?action=database.dump",
			"http://localhost/audit-events?actorId=invalid",
			"http://localhost/audit-events?page=0",
			"http://localhost/audit-events?pageSize=25",
			"http://localhost/audit-events?resourceType=credential",
			"http://localhost/audit-events?result=pending",
			"http://localhost/audit-events?sort=action%3Aasc",
			"http://localhost/audit-events?unknown=true",
		];
		for (const url of invalidUrls) {
			const { app, getAuditService } = testApp(service());
			const response = await app.handle(new Request(url));
			expect(response.status, url).toBe(422);
			expect(getAuditService).not.toHaveBeenCalled();
		}
	});

	it("maps domain validation and missing details to Problem Details", async () => {
		const cases = [
			{
				code: "VALIDATION_FAILED",
				error: new AuditValidationError([
					{ code: "INVALID_DATE", path: "from" },
				]),
				status: 422,
			},
			{
				code: "NOT_FOUND",
				error: new AuditEventNotFoundError(),
				status: 404,
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
				new Request(`http://localhost/audit-events/${EVENT_ID}`),
			);
			const problem = await readProblem(response);
			expect(response.status).toBe(testCase.status);
			expect(problem).toMatchObject({
				code: testCase.code,
				requestId: "req_audit",
			});
		}
	});

	it("requires a session before service resolution", async () => {
		const { app, getAuditService } = testApp(service(), { session: false });
		const response = await app.handle(
			new Request("http://localhost/audit-events"),
		);
		expect(response.status).toBe(500);
		expect(getAuditService).not.toHaveBeenCalled();
	});
});
