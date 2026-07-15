import { afterEach, describe, expect, it, vi } from "vitest";

import {
	canonicalVersionDescription,
	completeUploads,
	createVersion,
	deleteVersion,
	listVersions,
	requestUploadCredentials,
	setVersionActivation,
	updateVersion,
} from "./api";

const PROGRAM_ID = "ca6f79db-c7c4-4a34-9ab5-2a85ca9df501";
const VERSION_ID = "31ddcbe4-4a31-4c35-9738-e88d974a20f4";
const FILE_ID = "99dc12a2-3870-42c1-98a0-a6e9bac5bc10";
const ETAG = 'W/"1"' as const;

function versionResponse(status = 200): Response {
	return new Response(
		JSON.stringify({
			createdAt: "2026-07-15T00:00:00.000Z",
			description: "Stable",
			fileCount: 1,
			fileIds: [FILE_ID],
			id: VERSION_ID,
			isActive: false,
			isLatest: false,
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

	it("canonicalizes create fields at the transport boundary", async () => {
		const fetcher = vi.fn(
			async (_input: RequestInfo | URL, _init?: RequestInit) =>
				versionResponse(201),
		);
		vi.stubGlobal("fetch", fetcher);

		await createVersion(PROGRAM_ID, {
			description: "  Stable channel  ",
			fileIds: [FILE_ID],
			versionNumber: " 1.0.0 ",
		});

		const [, init] = fetcher.mock.calls[0] ?? [];
		expect(init?.method).toBe("POST");
		expect(JSON.parse(String(init?.body))).toEqual({
			description: "Stable channel",
			fileIds: [FILE_ID],
			versionNumber: "1.0.0",
		});
		expect(canonicalVersionDescription("   ")).toBe("");
	});

	it("preserves omitted fileIds while sending an explicit empty replacement", async () => {
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
		await updateVersion(PROGRAM_ID, VERSION_ID, { fileIds: [] }, ETAG);

		const firstInit = fetcher.mock.calls[0]?.[1];
		const secondInit = fetcher.mock.calls[1]?.[1];
		expect(JSON.parse(String(firstInit?.body))).toEqual({
			description: "Description only",
		});
		expect(JSON.parse(String(secondInit?.body))).toEqual({ fileIds: [] });
		expect(new Headers(secondInit?.headers).get("if-match")).toBe(ETAG);
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
		expect(fetcher.mock.calls[0]?.[0]).toBe(
			`/api/v1/programs/${PROGRAM_ID}/versions/${VERSION_ID}/activation`,
		);
		expect(
			new Headers(fetcher.mock.calls[0]?.[1]?.headers).get("if-match"),
		).toBe(ETAG);
	});

	it("requests credentials and completes metadata without sending File bodies", async () => {
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
							expiration: "2026-07-15T01:00:00.000Z",
							securityToken: "temporary-token",
						},
						objects: [{ objectKey: "prefix/key", path: "release/app.bin" }],
						region: "oss-cn-hangzhou",
					}),
					{ headers: { "content-type": "application/json" } },
				),
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

		await requestUploadCredentials({ files: [metadata] });
		await completeUploads({
			files: [
				{
					...metadata,
					objectEtag: '"etag"',
					objectKey: "prefix/key",
				},
			],
		});

		expect(JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body))).toEqual({
			files: [metadata],
		});
		expect(JSON.parse(String(fetcher.mock.calls[1]?.[1]?.body))).toEqual({
			files: [
				{
					...metadata,
					objectEtag: '"etag"',
					objectKey: "prefix/key",
				},
			],
		});
		expect(String(fetcher.mock.calls[0]?.[1]?.body)).not.toContain("File");
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
