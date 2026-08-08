import { Elysia } from "elysia";
import { describe, expect, it, vi } from "vitest";

import type { ApiProblem, EntityResult } from "../../../shared/api/common";
import type { FileDetailDto, FilePage } from "../../../shared/api/files";
import type { SafeSessionView } from "../../auth/session.server";
import {
	FileNotFoundError,
	type FilesService,
	VersionsValidationError,
} from "../../domain/versions.server";
import { ApiRequestContextStore } from "../context.server";
import { mapApiError } from "../problem";
import { createFilesModule } from "./files";

const FILE_ID = "00000000-0000-4000-8000-000000000030";

const detail: FileDetailDto = {
	checksumAlgorithm: "sha256",
	createdAt: "2026-07-14T01:00:00.000Z",
	id: FILE_ID,
	mimeType: "application/octet-stream",
	path: "release/app.bin",
	sha256: "a".repeat(64),
	size: "9223372036854775807",
	updatedAt: "2026-07-14T02:00:00.000Z",
};

const entity: EntityResult<FileDetailDto> = {
	data: detail,
	etag: 'W/"7"',
};

const page: FilePage = {
	items: [detail],
	page: 1,
	pageSize: 20,
	total: 1,
};

function service(overrides: Partial<FilesService> = {}): FilesService {
	return {
		getById: vi.fn(async () => entity),
		list: vi.fn(async () => page),
		...overrides,
	};
}

function testApp(
	filesService: FilesService,
	options: { readonly session?: boolean } = {},
) {
	const contextStore = new ApiRequestContextStore();
	const getFilesService = vi.fn(() => filesService);
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
		})
		.use(createFilesModule({ contextStore, getFilesService }));
	return { app, getFilesService };
}

async function readProblem(response: Response): Promise<ApiProblem> {
	expect(response.headers.get("content-type")).toBe("application/problem+json");
	return (await response.json()) as ApiProblem;
}

describe("files Elysia module", () => {
	it("keeps service creation lazy and lists with strict defaults", async () => {
		const list = vi.fn(async () => page);
		const { app, getFilesService } = testApp(service({ list }));
		expect(getFilesService).not.toHaveBeenCalled();

		const defaults = await app.handle(new Request("http://localhost/files"));
		expect(defaults.status).toBe(200);
		expect(await defaults.json()).toEqual(page);
		expect(list).toHaveBeenNthCalledWith(1, {
			page: 1,
			pageSize: 20,
			sort: "createdAt:desc",
		});

		const filtered = await app.handle(
			new Request(
				"http://localhost/files?path=release_%25&page=2&pageSize=50&sort=path%3Aasc",
			),
		);
		expect(filtered.status).toBe(200);
		expect(list).toHaveBeenNthCalledWith(2, {
			page: 2,
			pageSize: 50,
			path: "release_%",
			sort: "path:asc",
		});
	});

	it("returns metadata detail and its opaque row ETag", async () => {
		const getById = vi.fn(async () => entity);
		const { app } = testApp(service({ getById }));
		const response = await app.handle(
			new Request(`http://localhost/files/${FILE_ID}`),
		);

		expect(response.status).toBe(200);
		expect(response.headers.get("etag")).toBe('W/"7"');
		expect(await response.json()).toEqual(detail);
		expect(getById).toHaveBeenCalledWith(FILE_ID);
	});

	it("maps missing metadata and domain validation failures", async () => {
		const cases = [
			{ code: "NOT_FOUND", error: new FileNotFoundError(), status: 404 },
			{
				code: "VALIDATION_FAILED",
				error: new VersionsValidationError([
					{ code: "TOO_LONG", path: "path" },
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
				new Request(`http://localhost/files/${FILE_ID}`),
			);
			const problem = await readProblem(response);
			expect(response.status).toBe(testCase.status);
			expect(problem).toMatchObject({
				code: testCase.code,
				requestId: "req_test",
			});
		}
	});

	it("rejects non-whitelisted query values before service work", async () => {
		const { app, getFilesService } = testApp(service());
		for (const url of [
			"http://localhost/files?page=0",
			"http://localhost/files?pageSize=25",
			"http://localhost/files?sort=size%3Aasc",
		]) {
			const response = await app.handle(new Request(url));
			expect(response.status, url).toBe(422);
		}
		expect(getFilesService).not.toHaveBeenCalled();
	});

	it("requires a session before resolving the service", async () => {
		const { app, getFilesService } = testApp(service(), { session: false });
		const response = await app.handle(new Request("http://localhost/files"));
		expect(response.status).toBe(500);
		expect(getFilesService).not.toHaveBeenCalled();
	});
});
