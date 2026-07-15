import { afterEach, describe, expect, it, vi } from "vitest";

import type { SystemSettingsDto } from "../../shared/api/settings";
import { getSystemSettings, updateSystemSettings } from "./system-api";

const SETTINGS: SystemSettingsDto = {
	defaultLocale: "zh-CN",
	defaultPageSize: 20,
	repositoryUrl: null,
	systemName: "版本管理系统",
};

afterEach(() => vi.unstubAllGlobals());

describe("system settings API", () => {
	it("retains the response ETag with the singleton", async () => {
		const fetcher = vi.fn(
			async (_input: RequestInfo | URL, _init?: RequestInit) =>
				new Response(JSON.stringify(SETTINGS), {
					headers: {
						"content-type": "application/json",
						etag: 'W/"3"',
					},
				}),
		);
		vi.stubGlobal("fetch", fetcher);

		await expect(getSystemSettings()).resolves.toEqual({
			data: SETTINGS,
			etag: 'W/"3"',
		});
		expect(fetcher.mock.calls[0]?.[0]).toBe("/api/v1/settings/system");
	});

	it("normalizes values and sends the exact current ETag on update", async () => {
		const updated = {
			...SETTINGS,
			defaultLocale: "en" as const,
			defaultPageSize: 50 as const,
			repositoryUrl: null,
			systemName: "Updater Admin",
		};
		const fetcher = vi.fn(
			async (_input: RequestInfo | URL, _init?: RequestInit) =>
				new Response(JSON.stringify(updated), {
					headers: {
						"content-type": "application/json",
						etag: 'W/"4"',
					},
				}),
		);
		vi.stubGlobal("fetch", fetcher);

		await expect(
			updateSystemSettings(
				{
					defaultLocale: "en",
					defaultPageSize: 50,
					repositoryUrl: "   ",
					systemName: "  Updater Admin  ",
				},
				'W/"3"',
			),
		).resolves.toEqual({ data: updated, etag: 'W/"4"' });

		const [, init] = fetcher.mock.calls[0] ?? [];
		expect(init?.method).toBe("PATCH");
		expect(new Headers(init?.headers).get("if-match")).toBe('W/"3"');
		expect(JSON.parse(String(init?.body))).toEqual({
			defaultLocale: "en",
			defaultPageSize: 50,
			repositoryUrl: null,
			systemName: "Updater Admin",
		});
	});
});
