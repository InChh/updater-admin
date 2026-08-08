import { Elysia } from "elysia";
import { describe, expect, it, vi } from "vitest";

import {
	PUBLIC_RELEASE_DOWNLOAD_REQUEST_MAX_ITEMS,
	type PublicReleaseDownloadUrlsResponse,
	type PublicReleaseFilePageDto,
	type PublicReleaseHeaderDto,
	type PublicReleaseManifestDto,
} from "../../../shared/api/public-releases";
import {
	PublicReleaseCursorError,
	PublicReleaseNotFoundError,
	type PublicReleasesService,
	type PublicReleasesV2Service,
} from "../../domain/public-releases.server";
import { mapApiError } from "../problem";
import {
	createPublicReleasesModule,
	createPublicReleasesV2Module,
} from "./public-releases";

const PROGRAM_ID = "00000000-0000-4000-8000-000000000010";
const manifest: PublicReleaseManifestDto = {
	description: "Desktop release",
	downloadExpiresAt: "2026-07-20T02:05:00.000Z",
	files: [
		{
			checksumAlgorithm: "sha256",
			downloadUrl: "https://bucket.example/app.bin?x-oss-signature=short-lived",
			mimeType: "application/octet-stream",
			path: "app.bin",
			sha256: "a".repeat(64),
			size: "42",
		},
	],
	programId: PROGRAM_ID,
	programName: "Desktop",
	publishedAt: "2026-07-20T01:00:00.000Z",
	versionNumber: "10.2.3",
};
const header: PublicReleaseHeaderDto = {
	description: "Desktop release",
	fileCount: 10_001,
	programName: "Desktop",
	publishedAt: "2026-08-06T01:00:00.000Z",
	versionNumber: "10.2.3",
};
const page: PublicReleaseFilePageDto = {
	items: [
		{
			checksumAlgorithm: "sha256",
			mimeType: "application/octet-stream",
			path: "app.bin",
			sha256: "a".repeat(64),
			size: "42",
		},
	],
	nextCursor: "YXBwLmJpbg",
	pageSize: 2,
	versionNumber: "10.2.3",
};
const downloadUrls: PublicReleaseDownloadUrlsResponse = {
	downloadExpiresAt: "2026-08-06T02:05:00.000Z",
	files: [
		{
			downloadUrl: "https://bucket.example/app.bin?x-oss-signature=short-lived",
			path: "app.bin",
			sha256: "a".repeat(64),
		},
	],
};

function service(
	overrides: Partial<PublicReleasesService> = {},
): PublicReleasesService {
	return {
		getByVersionNumber: vi.fn(async () => manifest),
		getLatest: vi.fn(async () => manifest),
		...overrides,
	};
}

function v2Service(
	overrides: Partial<PublicReleasesV2Service> = {},
): PublicReleasesV2Service {
	return {
		getDownloadUrls: vi.fn(async () => downloadUrls),
		getFilePage: vi.fn(async () => page),
		getHeaderByVersionNumber: vi.fn(async () => header),
		getLatestHeader: vi.fn(async () => header),
		...overrides,
	};
}

function createProblemTestApp() {
	return new Elysia({ normalize: false }).onError((context) =>
		mapApiError(context, {
			getRequestId: () => "req_test",
		}),
	);
}

function testApp(publicReleasesService: PublicReleasesService) {
	const getPublicReleasesService = vi.fn(() => publicReleasesService);
	const app = createProblemTestApp().use(
		createPublicReleasesModule({ getPublicReleasesService }),
	);
	return { app, getPublicReleasesService };
}

function testV2App(publicReleasesService: PublicReleasesV2Service) {
	const getPublicReleasesV2Service = vi.fn(() => publicReleasesService);
	const app = createProblemTestApp().use(
		createPublicReleasesV2Module({ getPublicReleasesV2Service }),
	);
	return { app, getPublicReleasesV2Service };
}

async function readProblem(response: Response): Promise<unknown> {
	expect(response.headers.get("content-type")).toBe("application/problem+json");
	return response.json();
}

describe("public releases Elysia module", () => {
	it("preserves v1 latest route precedence and response shape", async () => {
		const getLatest = vi.fn(async () => manifest);
		const getByVersionNumber = vi.fn(async () => manifest);
		const { app, getPublicReleasesService } = testApp(
			service({ getByVersionNumber, getLatest }),
		);
		expect(getPublicReleasesService).not.toHaveBeenCalled();

		const response = await app.handle(
			new Request(`http://localhost/programs/${PROGRAM_ID}/releases/latest`),
		);

		expect(response.status).toBe(200);
		expect(await response.json()).toEqual(manifest);
		expect(getLatest).toHaveBeenCalledWith(PROGRAM_ID);
		expect(getByVersionNumber).not.toHaveBeenCalled();
	});

	it("preserves the v1 specified-version manifest without internal fields", async () => {
		const getByVersionNumber = vi.fn(async () => manifest);
		const { app } = testApp(service({ getByVersionNumber }));

		const response = await app.handle(
			new Request(`http://localhost/programs/${PROGRAM_ID}/releases/10.2.3`),
		);
		const body: unknown = await response.json();
		if (typeof body !== "object" || body === null) {
			throw new Error("public v1 response was not an object");
		}

		expect(response.status).toBe(200);
		expect(getByVersionNumber).toHaveBeenCalledWith(PROGRAM_ID, "10.2.3");
		expect(Object.keys(body).sort()).toEqual([
			"description",
			"downloadExpiresAt",
			"files",
			"programId",
			"programName",
			"publishedAt",
			"versionNumber",
		]);
		expect(JSON.stringify(body)).not.toMatch(
			/objectKey|objectEtag|createdBy|updatedBy|rowVersion|fileId|versionId/,
		);
	});

	it("serves v2 latest and specified finalized release headers", async () => {
		const getLatestHeader = vi.fn(async () => header);
		const getHeaderByVersionNumber = vi.fn(async () => header);
		const { app } = testV2App(
			v2Service({ getHeaderByVersionNumber, getLatestHeader }),
		);

		const latestResponse = await app.handle(
			new Request(`http://localhost/programs/${PROGRAM_ID}/releases/latest`),
		);
		const versionResponse = await app.handle(
			new Request(`http://localhost/programs/${PROGRAM_ID}/releases/10.2.3`),
		);

		expect(latestResponse.status).toBe(200);
		expect(await latestResponse.json()).toEqual(header);
		expect(versionResponse.status).toBe(200);
		expect(await versionResponse.json()).toEqual(header);
		expect(getLatestHeader).toHaveBeenCalledWith(PROGRAM_ID);
		expect(getHeaderByVersionNumber).toHaveBeenCalledWith(PROGRAM_ID, "10.2.3");
	});

	it("forwards bounded page search without adding download URLs", async () => {
		const getFilePage = vi.fn(async () => page);
		const { app } = testV2App(v2Service({ getFilePage }));

		const response = await app.handle(
			new Request(
				`http://localhost/programs/${PROGRAM_ID}/releases/10.2.3/files?cursor=YXBwLmJpbg&pageSize=2`,
			),
		);
		const body = await response.json();

		expect(response.status).toBe(200);
		expect(body).toEqual(page);
		expect(getFilePage).toHaveBeenCalledWith(PROGRAM_ID, "10.2.3", {
			cursor: "YXBwLmJpbg",
			pageSize: 2,
		});
		expect(JSON.stringify(body)).not.toMatch(
			/downloadUrl|objectKey|etag|fileId|versionId/,
		);
	});

	it("forwards only the explicit bounded path and hash signing request", async () => {
		const getDownloadUrls = vi.fn(async () => downloadUrls);
		const { app } = testV2App(v2Service({ getDownloadUrls }));
		const requestBody = {
			files: [{ path: "app.bin", sha256: "a".repeat(64) }],
		};

		const response = await app.handle(
			new Request(
				`http://localhost/programs/${PROGRAM_ID}/releases/10.2.3/download-urls`,
				{
					body: JSON.stringify(requestBody),
					headers: { "content-type": "application/json" },
					method: "POST",
				},
			),
		);

		expect(response.status).toBe(200);
		expect(await response.json()).toEqual(downloadUrls);
		expect(getDownloadUrls).toHaveBeenCalledWith(
			PROGRAM_ID,
			"10.2.3",
			requestBody,
		);
	});

	it("rejects an oversized selective signing request before service work", async () => {
		const getDownloadUrls = vi.fn(async () => downloadUrls);
		const { app } = testV2App(v2Service({ getDownloadUrls }));
		const response = await app.handle(
			new Request(
				`http://localhost/programs/${PROGRAM_ID}/releases/10.2.3/download-urls`,
				{
					body: JSON.stringify({
						files: Array.from(
							{ length: PUBLIC_RELEASE_DOWNLOAD_REQUEST_MAX_ITEMS + 1 },
							(_, index) => ({
								path: `${index}.bin`,
								sha256: index.toString(16).padStart(64, "0"),
							}),
						),
					}),
					headers: { "content-type": "application/json" },
					method: "POST",
				},
			),
		);

		expect(response.status).toBe(422);
		expect(getDownloadUrls).not.toHaveBeenCalled();
	});

	it("maps malformed or non-member cursors to bounded sanitized 400 problems", async () => {
		const { app } = testV2App(
			v2Service({
				getFilePage: async () => {
					throw new PublicReleaseCursorError();
				},
			}),
		);
		const response = await app.handle(
			new Request(
				`http://localhost/programs/${PROGRAM_ID}/releases/10.2.3/files?cursor=tampered`,
			),
		);

		expect(response.status).toBe(400);
		expect(await readProblem(response)).toEqual({
			code: "BAD_REQUEST",
			requestId: "req_test",
			status: 400,
			title: "The request could not be parsed",
			type: "https://updater-admin.local/problems/bad-request",
		});
	});

	it("maps missing releases and tampered path/hash identities to the same 404", async () => {
		const { app } = testV2App(
			v2Service({
				getDownloadUrls: async () => {
					throw new PublicReleaseNotFoundError();
				},
			}),
		);
		const response = await app.handle(
			new Request(
				`http://localhost/programs/${PROGRAM_ID}/releases/10.2.3/download-urls`,
				{
					body: JSON.stringify({
						files: [{ path: "tampered.bin", sha256: "f".repeat(64) }],
					}),
					headers: { "content-type": "application/json" },
					method: "POST",
				},
			),
		);

		expect(response.status).toBe(404);
		expect(await readProblem(response)).toMatchObject({ code: "NOT_FOUND" });
	});

	it("rejects an invalid program ID before constructing either service", async () => {
		const v1 = testApp(service());
		const v2 = testV2App(v2Service());
		const v1Response = await v1.app.handle(
			new Request("http://localhost/programs/not-a-uuid/releases/latest"),
		);
		const v2Response = await v2.app.handle(
			new Request("http://localhost/programs/not-a-uuid/releases/latest"),
		);

		expect(v1Response.status).toBe(422);
		expect(v2Response.status).toBe(422);
		expect(v1.getPublicReleasesService).not.toHaveBeenCalled();
		expect(v2.getPublicReleasesV2Service).not.toHaveBeenCalled();
	});

	it("sanitizes unexpected signer and provider failures", async () => {
		const secret =
			"https://bucket.example/file?x-oss-signature=must-not-escape";
		const { app } = testV2App(
			v2Service({
				getLatestHeader: async () => {
					throw new Error(secret);
				},
			}),
		);
		const response = await app.handle(
			new Request(`http://localhost/programs/${PROGRAM_ID}/releases/latest`),
		);
		const text = await response.text();

		expect(response.status).toBe(500);
		expect(text).toContain("INTERNAL_ERROR");
		expect(text).not.toContain(secret);
	});
});
