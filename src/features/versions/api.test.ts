import { afterEach, describe, expect, it, vi } from "vitest";

import {
	canonicalVersionDescription,
	completeDraftFiles,
	createVersion,
	deleteVersion,
	finalizeDraftVersion,
	listVersionFiles,
	listVersions,
	requestUploadCredentials,
	resolveDraftFiles,
	setVersionActivation,
	updateVersion,
} from "./api";

const PROGRAM_ID = "ca6f79db-c7c4-4a34-9ab5-2a85ca9df501";
const VERSION_ID = "31ddcbe4-4a31-4c35-9738-e88d974a20f4";
const ETAG = 'W/"1"' as const;

function versionResponse(status = 200): Response {
	return new Response(
		JSON.stringify({
			associatedFileCount: 0,
			createdAt: "2026-07-15T00:00:00.000Z",
			description: "Stable",
			expectedFileCount: 1,
			fileCount: 0,
			finalizedAt: null,
			id: VERSION_ID,
			isActive: false,
			isLatest: false,
			lifecycleStatus: "draft",
			programId: PROGRAM_ID,
			updatedAt: "2026-07-15T00:00:00.000Z",
			versionNumber: "1.0.0",
		}),
		{
			headers: { "content-type": "application/json", etag: ETAG },
			status,
		},
	);
}

afterEach(() => vi.unstubAllGlobals());

describe("version API client", () => {
	it("normalizes list pagination and serializes only the supported sort", async () => {
		const fetcher = vi.fn(
			async (_input: RequestInfo | URL, _init?: RequestInit) =>
				new Response(
					JSON.stringify({ items: [], page: 1, pageSize: 20, total: 0 }),
					{ headers: { "content-type": "application/json" } },
				),
		);
		vi.stubGlobal("fetch", fetcher);

		await listVersions(PROGRAM_ID, {
			page: 1_000_001,
			pageSize: 50,
			sort: "createdAt:asc",
		});

		expect(fetcher.mock.calls[0]?.[0]).toBe(
			`/api/v1/programs/${PROGRAM_ID}/versions?page=1&pageSize=50&sort=createdAt%3Aasc`,
		);
	});

	it("creates a bounded draft and finalizes it without a file ID array", async () => {
		const fetcher = vi.fn(
			async (_input: RequestInfo | URL, _init?: RequestInit) =>
				versionResponse(201),
		);
		vi.stubGlobal("fetch", fetcher);

		await createVersion(PROGRAM_ID, {
			description: "  Stable channel  ",
			expectedFileCount: 10_001,
			versionNumber: " 1.0.0 ",
		});
		await finalizeDraftVersion(PROGRAM_ID, VERSION_ID, ETAG);

		expect(fetcher.mock.calls[0]?.[0]).toBe(
			`/api/v1/programs/${PROGRAM_ID}/versions/drafts`,
		);
		expect(JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body))).toEqual({
			description: "Stable channel",
			expectedFileCount: 10_001,
			versionNumber: "1.0.0",
		});
		expect(fetcher.mock.calls[1]?.[0]).toBe(
			`/api/v1/programs/${PROGRAM_ID}/versions/${VERSION_ID}/finalize`,
		);
		expect(JSON.parse(String(fetcher.mock.calls[1]?.[1]?.body))).toEqual({});
		expect(
			new Headers(fetcher.mock.calls[1]?.[1]?.headers).get(
				"x-updater-if-match",
			),
		).toBe(ETAG);
		expect(canonicalVersionDescription("   ")).toBe("");
	});

	it("updates only finalized metadata fields", async () => {
		const fetcher = vi.fn(
			async (_input: RequestInfo | URL, _init?: RequestInit) =>
				versionResponse(),
		);
		vi.stubGlobal("fetch", fetcher);

		await updateVersion(
			PROGRAM_ID,
			VERSION_ID,
			{ description: "  Description only " },
			ETAG,
		);

		expect(JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body))).toEqual({
			description: "Description only",
		});
		expect(
			new Headers(fetcher.mock.calls[0]?.[1]?.headers).get(
				"x-updater-if-match",
			),
		).toBe(ETAG);
	});

	it("uses ETag-protected PUT activation and DELETE endpoints", async () => {
		const fetcher = vi
			.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
				versionResponse(),
			)
			.mockResolvedValueOnce(versionResponse())
			.mockResolvedValueOnce(new Response(null, { status: 204 }));
		vi.stubGlobal("fetch", fetcher);

		await setVersionActivation(
			PROGRAM_ID,
			VERSION_ID,
			{ isActive: true },
			ETAG,
		);
		await deleteVersion(PROGRAM_ID, VERSION_ID, ETAG);

		expect(fetcher.mock.calls.map(([, init]) => init?.method)).toEqual([
			"PUT",
			"DELETE",
		]);
	});

	it("keeps credentials file-agnostic and scopes resolve/complete to the draft", async () => {
		const fetcher = vi
			.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
				versionResponse(),
			)
			.mockResolvedValueOnce(
				new Response(
					JSON.stringify({
						bucket: "bucket",
						credentials: {
							accessKeyId: "temporary-id",
							accessKeySecret: "temporary-secret",
							expiration: "2099-07-15T01:00:00.000Z",
							securityToken: "temporary-token",
						},
						region: "oss-cn-hangzhou",
						uploadPrefix: "prefix/",
					}),
					{ headers: { "content-type": "application/json" } },
				),
			)
			.mockResolvedValueOnce(
				new Response(JSON.stringify({ files: [] }), {
					headers: { "content-type": "application/json" },
				}),
			)
			.mockResolvedValueOnce(
				new Response(JSON.stringify({ files: [] }), {
					headers: { "content-type": "application/json" },
				}),
			);
		vi.stubGlobal("fetch", fetcher);
		const metadata = {
			mimeType: "application/octet-stream",
			path: "release/app.bin",
			sha256: "a".repeat(64),
			size: "7",
		};

		await requestUploadCredentials({});
		await resolveDraftFiles(PROGRAM_ID, VERSION_ID, { files: [metadata] });
		await completeDraftFiles(PROGRAM_ID, VERSION_ID, {
			files: [{ ...metadata, objectKey: "prefix/key" }],
		});

		expect(JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body))).toEqual({});
		expect(fetcher.mock.calls[1]?.[0]).toBe(
			`/api/v1/programs/${PROGRAM_ID}/versions/${VERSION_ID}/files/resolve`,
		);
		expect(fetcher.mock.calls[2]?.[0]).toBe(
			`/api/v1/programs/${PROGRAM_ID}/versions/${VERSION_ID}/files/complete`,
		);
	});

	it("lists draft files with a bounded cursor query", async () => {
		const fetcher = vi.fn(
			async (_input: RequestInfo | URL, _init?: RequestInit) =>
				new Response(
					JSON.stringify({
						items: [],
						nextCursor: null,
						pageSize: 200,
						versionId: VERSION_ID,
					}),
					{ headers: { "content-type": "application/json" } },
				),
		);
		vi.stubGlobal("fetch", fetcher);

		await listVersionFiles(PROGRAM_ID, VERSION_ID, {
			cursor: "next",
			pageSize: 200,
		});

		expect(fetcher.mock.calls[0]?.[0]).toBe(
			`/api/v1/programs/${PROGRAM_ID}/versions/${VERSION_ID}/files?cursor=next&pageSize=200`,
		);
	});

	it("rejects non-canonical resource IDs before fetch", async () => {
		const fetcher = vi.fn(
			async (_input: RequestInfo | URL, _init?: RequestInit) =>
				versionResponse(),
		);
		vi.stubGlobal("fetch", fetcher);

		await expect(
			listVersions("not-a-uuid", {
				page: 1,
				pageSize: 20,
				sort: "createdAt:desc",
			}),
		).rejects.toThrow("Invalid program ID");
		expect(() =>
			setVersionActivation(PROGRAM_ID, "not-a-uuid", { isActive: true }, ETAG),
		).toThrow("Invalid version ID");
		expect(fetcher).not.toHaveBeenCalled();
	});
});
