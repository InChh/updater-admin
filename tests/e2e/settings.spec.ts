import { expect, test } from "@playwright/test";

import type { ProfileDto } from "../../src/shared/api/profile";
import type { SystemSettingsDto } from "../../src/shared/api/settings";
import {
	AUTHENTICATED_E2E_SKIP_REASON,
	fulfillJson,
	HAS_E2E_ADMIN_CREDENTIALS,
	parseRequestBody,
	signIn,
} from "./support";

const INITIAL_SETTINGS: SystemSettingsDto = {
	defaultLocale: "zh-CN",
	defaultPageSize: 20,
	repositoryUrl: null,
	systemName: "Fixture system",
};

const FRESH_SETTINGS: SystemSettingsDto = {
	...INITIAL_SETTINGS,
	defaultPageSize: 50,
	systemName: "Fresh system",
};

test.describe("profile and system settings", () => {
	test.skip(!HAS_E2E_ADMIN_CREDENTIALS, AUTHENTICATED_E2E_SKIP_REASON);

	test("switches locale through the profile concurrency contract without persisting fixture data", async ({
		page,
	}) => {
		await signIn(page);

		const profileResponse = await page.request.get("/api/v1/profile");
		expect(profileResponse.status()).toBe(200);
		const currentEtag = profileResponse.headers().etag;
		expect(currentEtag).toMatch(/^W\/"[1-9][0-9]*"$/);
		const profile = (await profileResponse.json()) as ProfileDto;
		const targetLocale = profile.locale === "en" ? "zh-CN" : "en";
		const patchBodies: Record<string, unknown>[] = [];
		let observedIfMatch: string | undefined;

		await page.route("**/api/v1/profile", async (route) => {
			const request = route.request();
			if (request.method() !== "PATCH") {
				await route.continue();
				return;
			}
			patchBodies.push(parseRequestBody(request.postData()));
			observedIfMatch = request.headers()["if-match"];
			await fulfillJson(
				route,
				{ ...profile, locale: targetLocale },
				{ etag: 'W/"999999"' },
			);
		});

		await page.getByRole("button", { name: /语言菜单|Language menu/ }).click();
		await page
			.getByRole("menuitemradio", {
				name: targetLocale === "en" ? "English" : "中文",
			})
			.click();

		await expect(
			page.getByRole("heading", {
				exact: true,
				level: 1,
				name: targetLocale === "en" ? "Programs" : "程序",
			}),
		).toBeVisible();
		expect(observedIfMatch).toBe(currentEtag);
		expect(patchBodies).toEqual([{ locale: targetLocale }]);
	});

	test("refreshes the singleton form after a stale system-settings write", async ({
		page,
	}) => {
		let staleWriteReturned = false;
		let observedIfMatch: string | undefined;
		const patchBodies: Record<string, unknown>[] = [];

		await page.route("**/api/v1/settings/system", async (route) => {
			const request = route.request();
			const url = new URL(request.url());
			if (url.pathname !== "/api/v1/settings/system") {
				await route.continue();
				return;
			}
			if (request.method() === "GET") {
				await fulfillJson(
					route,
					staleWriteReturned ? FRESH_SETTINGS : INITIAL_SETTINGS,
					{ etag: staleWriteReturned ? 'W/"9"' : 'W/"7"' },
				);
				return;
			}
			if (request.method() === "PATCH") {
				patchBodies.push(parseRequestBody(request.postData()));
				observedIfMatch = request.headers()["if-match"];
				staleWriteReturned = true;
				await fulfillJson(
					route,
					{
						code: "STALE_WRITE",
						requestId: "e2e-settings-stale",
						status: 409,
						title: "The resource changed since it was loaded",
						type: "https://updater-admin.local/problems/stale-write",
					},
					{
						headers: { "x-request-id": "e2e-settings-stale" },
						status: 409,
					},
				);
				return;
			}
			await route.continue();
		});

		await signIn(page);
		await page.goto("/settings/system");
		const systemName = page.getByLabel(/系统名称|System name/);
		await expect(systemName).toHaveValue(INITIAL_SETTINGS.systemName);
		await systemName.fill("Attempted stale update");
		await page.getByRole("button", { name: /保存更改|Save changes/ }).click();

		await expect(systemName).toHaveValue(FRESH_SETTINGS.systemName);
		await expect(
			page.getByText(
				/系统设置已在其他位置更新|System settings changed elsewhere/,
			),
		).toBeVisible();
		expect(observedIfMatch).toBe('W/"7"');
		expect(patchBodies).toEqual([
			{
				defaultLocale: INITIAL_SETTINGS.defaultLocale,
				defaultPageSize: INITIAL_SETTINGS.defaultPageSize,
				repositoryUrl: null,
				systemName: "Attempted stale update",
			},
		]);
	});
});
