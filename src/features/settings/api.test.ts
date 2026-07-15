import { afterEach, describe, expect, it, vi } from "vitest";

import type { ProfileDto } from "../../shared/api/profile";
import { getProfile, updateProfile } from "./api";

const PROFILE: ProfileDto = {
	currentSession: {
		createdAt: "2026-07-15T00:00:00.000Z",
		expiresAt: "2026-07-16T00:00:00.000Z",
		id: "ca6f79db-c7c4-4a34-9ab5-2a85ca9df501",
		updatedAt: "2026-07-15T00:00:00.000Z",
	},
	email: "admin@example.com",
	emailVerified: true,
	id: "ba6f79db-c7c4-4a34-9ab5-2a85ca9df502",
	image: null,
	lastLoginAt: "2026-07-15T01:00:00.000Z",
	locale: "en",
	mustChangePassword: false,
	name: "Release Admin",
	otherSessions: [],
};

afterEach(() => vi.unstubAllGlobals());

describe("profile API", () => {
	it("pairs the profile body with the response ETag", async () => {
		const fetcher = vi.fn(
			async (_input: RequestInfo | URL, _init?: RequestInit) =>
				new Response(JSON.stringify(PROFILE), {
					headers: {
						"content-type": "application/json",
						etag: 'W/"3"',
					},
				}),
		);
		vi.stubGlobal("fetch", fetcher);

		await expect(getProfile()).resolves.toEqual({
			data: PROFILE,
			etag: 'W/"3"',
		});
	});

	it("sends the exact profile ETag when saving profile changes", async () => {
		const fetcher = vi.fn(
			async (_input: RequestInfo | URL, _init?: RequestInit) =>
				new Response(JSON.stringify({ ...PROFILE, locale: "zh-CN" }), {
					headers: {
						"content-type": "application/json",
						etag: 'W/"4"',
					},
				}),
		);
		vi.stubGlobal("fetch", fetcher);

		await expect(
			updateProfile({ locale: "zh-CN", name: " Release Admin " }, 'W/"3"'),
		).resolves.toEqual({
			data: { ...PROFILE, locale: "zh-CN" },
			etag: 'W/"4"',
		});

		const [, init] = fetcher.mock.calls[0] ?? [];
		const headers = new Headers(init?.headers);
		expect(init?.method).toBe("PATCH");
		expect(headers.get("if-match")).toBe('W/"3"');
		expect(JSON.parse(String(init?.body))).toEqual({
			locale: "zh-CN",
			name: "Release Admin",
		});
	});
});
