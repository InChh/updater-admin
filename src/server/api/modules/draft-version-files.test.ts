import { Elysia } from "elysia";
import { describe, expect, it, vi } from "vitest";

import type { ApiProblem } from "../../../shared/api/common";
import type { SafeSessionView } from "../../auth/session.server";
import {
	type DraftVersionFilesService,
	DraftVersionFinalizedError,
	DraftVersionPathConflictError,
} from "../../domain/draft-version-files.server";
import { ApiRequestContextStore } from "../context.server";
import { mapApiError } from "../problem";
import { createDraftVersionFilesModule } from "./draft-version-files";

const PROGRAM_ID = "00000000-0000-4000-8000-000000000010";
const VERSION_ID = "00000000-0000-4000-8000-000000000020";
const FILE_ID = "00000000-0000-4000-8000-000000000030";
const ACTOR_ID = "00000000-0000-4000-8000-000000000001";
const SHA256 = "a".repeat(64);

const fileMetadata = {
	checksumAlgorithm: "sha256" as const,
	createdAt: "2026-08-06T01:00:00.000Z",
	id: FILE_ID,
	mimeType: "application/octet-stream",
	path: "app.bin",
	sha256: SHA256,
	size: "42",
	updatedAt: "2026-08-06T01:00:00.000Z",
};

function file() {
	return {
		mimeType: "application/octet-stream",
		path: "app.bin",
		sha256: SHA256,
		size: "42",
	};
}

function service(
	overrides: Partial<DraftVersionFilesService> = {},
): DraftVersionFilesService {
	return {
		complete: vi.fn(async () => ({ files: [fileMetadata] })),
		listFiles: vi.fn(async () => ({
			items: [fileMetadata],
			nextCursor: null,
			pageSize: 200,
			versionId: VERSION_ID,
		})),
		resolve: vi.fn(async () => ({
			files: [
				{
					canonicalMimeType: "application/octet-stream",
					path: "app.bin",
					status: "reused" as const,
				},
			],
		})),
		...overrides,
	};
}

function testApp(
	draftService: DraftVersionFilesService,
	options: { readonly audit?: boolean; readonly session?: boolean } = {},
) {
	const contextStore = new ApiRequestContextStore();
	const getDraftVersionFilesService = vi.fn(() => draftService);
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
		.use(
			createDraftVersionFilesModule({
				contextStore,
				getDraftVersionFilesService,
			}),
		);
	return { app, getDraftVersionFilesService };
}

async function readProblem(response: Response): Promise<ApiProblem> {
	expect(response.headers.get("content-type")).toBe("application/problem+json");
	return (await response.json()) as ApiProblem;
}

describe("draft version files Elysia module", () => {
	it("resolves a bounded metadata batch without object keys", async () => {
		const resolve = vi.fn(async () => ({
			files: [{ path: "app.bin", status: "uploadRequired" as const }],
		}));
		const { app } = testApp(service({ resolve }));
		const response = await app.handle(
			new Request(
				`http://localhost/programs/${PROGRAM_ID}/versions/${VERSION_ID}/files/resolve`,
				{
					body: JSON.stringify({ files: [file()] }),
					headers: { "content-type": "application/json" },
					method: "POST",
				},
			),
		);
		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({
			files: [{ path: "app.bin", status: "uploadRequired" }],
		});
		expect(resolve).toHaveBeenCalledWith(
			PROGRAM_ID,
			VERSION_ID,
			{ files: [file()] },
			expect.objectContaining({ actorId: ACTOR_ID }),
		);
	});

	it("completes uploaded proofs against the addressed draft", async () => {
		const complete = vi.fn(async () => ({ files: [fileMetadata] }));
		const { app } = testApp(service({ complete }));
		const input = {
			files: [
				{
					...file(),
					objectKey: `releases/${SHA256}/app.bin`,
				},
			],
		};
		const response = await app.handle(
			new Request(
				`http://localhost/programs/${PROGRAM_ID}/versions/${VERSION_ID}/files/complete`,
				{
					body: JSON.stringify(input),
					headers: { "content-type": "application/json" },
					method: "POST",
				},
			),
		);
		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ files: [fileMetadata] });
		expect(complete).toHaveBeenCalledWith(
			PROGRAM_ID,
			VERSION_ID,
			input,
			expect.objectContaining({ actorId: ACTOR_ID }),
		);
	});

	it("returns a cursor-paged admin file list", async () => {
		const listFiles = vi.fn(async () => ({
			items: [fileMetadata],
			nextCursor: "YXBwLmJpbg",
			pageSize: 25,
			versionId: VERSION_ID,
		}));
		const { app } = testApp(service({ listFiles }));
		const response = await app.handle(
			new Request(
				`http://localhost/programs/${PROGRAM_ID}/versions/${VERSION_ID}/files?pageSize=25`,
			),
		);
		expect(response.status).toBe(200);
		expect(await response.json()).toMatchObject({
			items: [fileMetadata],
			pageSize: 25,
			versionId: VERSION_ID,
		});
		expect(listFiles).toHaveBeenCalledWith(PROGRAM_ID, VERSION_ID, {
			pageSize: 25,
		});
	});

	it("enforces resolve and completion transport bounds", async () => {
		const { app } = testApp(service());
		const resolveResponse = await app.handle(
			new Request(
				`http://localhost/programs/${PROGRAM_ID}/versions/${VERSION_ID}/files/resolve`,
				{
					body: JSON.stringify({
						files: Array.from({ length: 101 }, (_, index) => ({
							...file(),
							path: `file-${index}.bin`,
						})),
					}),
					headers: { "content-type": "application/json" },
					method: "POST",
				},
			),
		);
		expect(resolveResponse.status).toBe(422);

		const completeResponse = await app.handle(
			new Request(
				`http://localhost/programs/${PROGRAM_ID}/versions/${VERSION_ID}/files/complete`,
				{
					body: JSON.stringify({
						files: Array.from({ length: 26 }, (_, index) => ({
							...file(),
							objectKey: `releases/${SHA256}/file-${index}.bin`,
							path: `file-${index}.bin`,
						})),
					}),
					headers: { "content-type": "application/json" },
					method: "POST",
				},
			),
		);
		expect(completeResponse.status).toBe(422);
	});

	it("maps immutable finalized membership and path conflicts", async () => {
		for (const [error, code] of [
			[new DraftVersionFinalizedError(), "VERSION_FINALIZED"],
			[new DraftVersionPathConflictError(0), "DRAFT_PATH_CONFLICT"],
		] as const) {
			const { app } = testApp(
				service({
					resolve: vi.fn(async () => {
						throw error;
					}),
				}),
			);
			const response = await app.handle(
				new Request(
					`http://localhost/programs/${PROGRAM_ID}/versions/${VERSION_ID}/files/resolve`,
					{
						body: JSON.stringify({ files: [file()] }),
						headers: { "content-type": "application/json" },
						method: "POST",
					},
				),
			);
			expect(response.status).toBe(409);
			expect(await readProblem(response)).toMatchObject({ code });
		}
	});
});
