import { afterEach, describe, expect, it, vi } from "vitest";

import { listAdministrators, updateAdministrator } from "./api";

const ADMINISTRATOR_ID = "ca6f79db-c7c4-4a34-9ab5-2a85ca9df501";
const ADMINISTRATOR = {
	createdAt: "2026-07-15T00:00:00.000Z",
	email: "admin@example.com",
	enabled: true,
	etag: 'W/"2"',
	id: ADMINISTRATOR_ID,
	lastLoginAt: null,
	locale: "en",
	mustChangePassword: false,
	name: "Release Admin",
	updatedAt: "2026-07-15T00:00:00.000Z",
} as const;

afterEach(() => vi.unstubAllGlobals());

describe("administrator API", () => {
	it("normalizes list search into a canonical query string", async () => {
		const fetcher = vi.fn(
			async (_input: RequestInfo | URL, _init?: RequestInit) =>
				new Response(
					JSON.stringify({ items: [], page: 1, pageSize: 20, total: 0 }),
					{ headers: { "content-type": "application/json" } },
				),
		);
		vi.stubGlobal("fetch", fetcher);

		await listAdministrators({
			page: -1,
			pageSize: 20,
			query: "  release@example.com  ",
			sort: "createdAt:desc",
			status: "active",
		});

		expect(String(fetcher.mock.calls[0]?.[0])).toBe(
			"/api/v1/administrators?page=1&pageSize=20&sort=createdAt%3Adesc&query=release%40example.com&status=active",
		);
	});

	it("sends the exact row ETag for administrator status mutations", async () => {
		const fetcher = vi.fn(
			async (_input: RequestInfo | URL, _init?: RequestInit) =>
				new Response(JSON.stringify(ADMINISTRATOR), {
					headers: { "content-type": "application/json" },
				}),
		);
		vi.stubGlobal("fetch", fetcher);

		await updateAdministrator(ADMINISTRATOR_ID, { enabled: false }, 'W/"1"');

		const [, init] = fetcher.mock.calls[0] ?? [];
		const headers = new Headers(init?.headers);
		expect(init?.method).toBe("PATCH");
		expect(headers.get("if-match")).toBe('W/"1"');
		expect(JSON.parse(String(init?.body))).toEqual({ enabled: false });
	});
});
