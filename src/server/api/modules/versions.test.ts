import { Elysia } from "elysia";
import { describe, expect, it, vi } from "vitest";

import type { ApiProblem, EntityResult } from "../../../shared/api/common";
import type {
	VersionDetailDto,
	VersionPage,
} from "../../../shared/api/versions";
import type { SafeSessionView } from "../../auth/session.server";
import {
	DraftIncompleteError,
	VersionFinalizedRequiredError,
	type VersionsService,
} from "../../domain/versions.server";
import { ApiRequestContextStore } from "../context.server";
import { mapApiError } from "../problem";
import { createVersionsModule } from "./versions";

const PROGRAM_ID = "00000000-0000-4000-8000-000000000010";
const VERSION_ID = "00000000-0000-4000-8000-000000000020";
const ACTOR_ID = "00000000-0000-4000-8000-000000000001";

const detail: VersionDetailDto = {
	associatedFileCount: 3,
	createdAt: "2026-08-06T01:00:00.000Z",
	description: "Desktop build",
	expectedFileCount: 3,
	fileCount: 3,
	finalizedAt: "2026-08-06T02:00:00.000Z",
	id: VERSION_ID,
	isActive: false,
	isLatest: false,
	lifecycleStatus: "finalized",
	programId: PROGRAM_ID,
	updatedAt: "2026-08-06T02:00:00.000Z",
	versionNumber: "2.0.0",
};

const draft: VersionDetailDto = {
	...detail,
	associatedFileCount: 0,
	fileCount: 0,
	finalizedAt: null,
	lifecycleStatus: "draft",
};

const entity: EntityResult<VersionDetailDto> = {
	data: detail,
	etag: 'W/"3"',
};

const draftEntity: EntityResult<VersionDetailDto> = {
	data: draft,
	etag: 'W/"1"',
};

const page: VersionPage = {
	items: [{ ...detail, etag: 'W/"3"' }],
	page: 1,
	pageSize: 20,
	total: 1,
};

function service(overrides: Partial<VersionsService> = {}): VersionsService {
	return {
		createDraft: vi.fn(async () => draftEntity),
		delete: vi.fn(async () => {}),
		finalize: vi.fn(async () => entity),
		getById: vi.fn(async () => entity),
		list: vi.fn(async () => page),
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
				contextStore.setSession(request, {
					user: { id: ACTOR_ID },
				} as SafeSessionView);
			}
			if (options.audit !== false) {
				contextStore.setAudit(request, {
					actorId: ACTOR_ID,
					ip: "203.0.113.8",
					requestId: "req_test",
					userAgent: "vitest",
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
	it("lists existing finalized versions with lifecycle fields", async () => {
		const list = vi.fn(async () => page);
		const { app } = testApp(service({ list }));
		const response = await app.handle(
			new Request(`http://localhost/programs/${PROGRAM_ID}/versions`),
		);
		expect(response.status).toBe(200);
		expect(await response.json()).toEqual(page);
		expect(list).toHaveBeenCalledWith(PROGRAM_ID, {
			page: 1,
			pageSize: 20,
			sort: "createdAt:desc",
		});
	});

	it("creates a draft with 201, Location, ETag, and no fileIds", async () => {
		const createDraft = vi.fn(async () => draftEntity);
		const { app } = testApp(service({ createDraft }));
		const response = await app.handle(
			new Request(`http://localhost/programs/${PROGRAM_ID}/versions/drafts`, {
				body: JSON.stringify({
					description: "Desktop build",
					expectedFileCount: 3,
					versionNumber: "2.0.0",
				}),
				headers: { "content-type": "application/json" },
				method: "POST",
			}),
		);
		expect(response.status).toBe(201);
		expect(response.headers.get("etag")).toBe('W/"1"');
		expect(response.headers.get("location")).toBe(
			`/api/v1/programs/${PROGRAM_ID}/versions/${VERSION_ID}`,
		);
		expect(await response.json()).toEqual(draft);
		expect(createDraft).toHaveBeenCalledWith(
			PROGRAM_ID,
			{
				description: "Desktop build",
				expectedFileCount: 3,
				versionNumber: "2.0.0",
			},
			expect.objectContaining({ actorId: ACTOR_ID }),
		);
	});

	it("rejects legacy full fileIds draft creation", async () => {
		const { app } = testApp(service());
		const response = await app.handle(
			new Request(`http://localhost/programs/${PROGRAM_ID}/versions/drafts`, {
				body: JSON.stringify({
					expectedFileCount: 1,
					fileIds: ["00000000-0000-4000-8000-000000000030"],
					versionNumber: "2.0.0",
				}),
				headers: { "content-type": "application/json" },
				method: "POST",
			}),
		);
		expect(response.status).toBe(422);
	});

	it("finalizes with the application ETag header and returns the next ETag", async () => {
		const finalize = vi.fn(async () => entity);
		const { app } = testApp(service({ finalize }));
		const response = await app.handle(
			new Request(
				`http://localhost/programs/${PROGRAM_ID}/versions/${VERSION_ID}/finalize`,
				{
					body: "{}",
					headers: {
						"content-type": "application/json",
						"x-updater-if-match": 'W/"2"',
					},
					method: "POST",
				},
			),
		);
		expect(response.status).toBe(200);
		expect(response.headers.get("etag")).toBe('W/"3"');
		expect(finalize).toHaveBeenCalledWith(
			PROGRAM_ID,
			VERSION_ID,
			'W/"2"',
			expect.objectContaining({ actorId: ACTOR_ID }),
		);
	});

	it("maps incomplete finalization to a stable conflict", async () => {
		const { app } = testApp(
			service({
				finalize: vi.fn(async () => {
					throw new DraftIncompleteError(3, 2);
				}),
			}),
		);
		const response = await app.handle(
			new Request(
				`http://localhost/programs/${PROGRAM_ID}/versions/${VERSION_ID}/finalize`,
				{
					body: "{}",
					headers: {
						"content-type": "application/json",
						"x-updater-if-match": 'W/"2"',
					},
					method: "POST",
				},
			),
		);
		expect(response.status).toBe(409);
		expect(await readProblem(response)).toMatchObject({
			code: "DRAFT_INCOMPLETE",
		});
	});

	it("rejects draft activation with a lifecycle conflict", async () => {
		const { app } = testApp(
			service({
				setActivation: vi.fn(async () => {
					throw new VersionFinalizedRequiredError();
				}),
			}),
		);
		const response = await app.handle(
			new Request(
				`http://localhost/programs/${PROGRAM_ID}/versions/${VERSION_ID}/activation`,
				{
					body: JSON.stringify({ isActive: true }),
					headers: {
						"content-type": "application/json",
						"x-updater-if-match": 'W/"1"',
					},
					method: "PUT",
				},
			),
		);
		expect(response.status).toBe(409);
		expect(await readProblem(response)).toMatchObject({
			code: "VERSION_NOT_FINALIZED",
		});
	});
});
