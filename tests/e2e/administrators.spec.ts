import { expect, type Page, test } from "@playwright/test";

import type {
	AdministratorDto,
	AdministratorPage,
} from "../../src/shared/api/administrators";
import {
	AUTHENTICATED_E2E_SKIP_REASON,
	captureScreenshot,
	fulfillJson,
	HAS_E2E_ADMIN_CREDENTIALS,
	signIn,
	submitSignIn,
} from "./support";

const ADMINISTRATOR: AdministratorDto = {
	createdAt: "2026-07-15T02:00:00.000Z",
	email: "fixture-admin@example.com",
	enabled: true,
	etag: 'W/"7"',
	id: "11111111-1111-4111-8111-111111111111",
	lastLoginAt: "2026-07-15T03:00:00.000Z",
	locale: "en",
	mustChangePassword: false,
	name: "Fixture administrator",
	updatedAt: "2026-07-15T03:00:00.000Z",
};

function mutationHeaders(
	page: Page,
	headers: Readonly<Record<string, string>> = {},
): Record<string, string> {
	return { ...headers, origin: new URL(page.url()).origin };
}

async function signOutViaUi(page: Page): Promise<void> {
	await page.getByRole("button", { name: /账户菜单|Account menu/ }).click();
	await page.getByRole("menuitem", { name: /退出登录|Sign out/ }).click();
	await expect.poll(() => new URL(page.url()).pathname).toBe("/login");
}

async function findAdministrator(
	page: Page,
	email: string,
): Promise<AdministratorDto | undefined> {
	const parameters = new URLSearchParams({
		page: "1",
		pageSize: "20",
		query: email,
		sort: "createdAt:desc",
	});
	const response = await page.request.get(
		`/api/v1/administrators?${parameters.toString()}`,
	);
	if (!response.ok()) return undefined;
	const result = (await response.json()) as AdministratorPage;
	return result.items.find((administrator) => administrator.email === email);
}

function revokeAdministratorSessions(page: Page, administratorId: string) {
	return page.request.post(
		`/api/v1/administrators/${administratorId}/revoke-sessions`,
		{ headers: mutationHeaders(page) },
	);
}

function disableAdministrator(page: Page, administrator: AdministratorDto) {
	return page.request.patch(`/api/v1/administrators/${administrator.id}`, {
		data: { enabled: false },
		headers: mutationHeaders(page, {
			"x-updater-if-match": administrator.etag,
		}),
	});
}

async function bestEffortDisableAdministrator(
	page: Page,
	email: string,
): Promise<void> {
	try {
		await page.context().clearCookies();
		await signIn(page);
		const administrator = await findAdministrator(page, email);
		if (!administrator) return;
		await revokeAdministratorSessions(page, administrator.id);
		if (administrator.enabled) {
			await disableAdministrator(page, administrator);
		}
	} catch {
		// Cleanup must not replace the primary test failure when the environment
		// itself is unavailable; the account remains uniquely identifiable.
	}
}

test.describe("administrator management", () => {
	test.skip(!HAS_E2E_ADMIN_CREDENTIALS, AUTHENTICATED_E2E_SKIP_REASON);

	test("filters the server-owned table and opens a labelled create dialog without writing", async ({
		page,
	}, testInfo) => {
		await signIn(page);

		const requestedQueries: URLSearchParams[] = [];
		await page.route("**/api/v1/administrators**", async (route) => {
			const request = route.request();
			const url = new URL(request.url());
			if (
				request.method() !== "GET" ||
				url.pathname !== "/api/v1/administrators"
			) {
				await route.continue();
				return;
			}
			requestedQueries.push(new URLSearchParams(url.searchParams));
			await fulfillJson(route, {
				items: [ADMINISTRATOR],
				page: Number(url.searchParams.get("page") ?? 1),
				pageSize: Number(url.searchParams.get("pageSize") ?? 20),
				total: 1,
			});
		});

		await page.goto("/administrators?page=1&pageSize=20&sort=name%3Aasc");
		await expect(
			page.getByRole("heading", { level: 1, name: /管理员|Administrators/ }),
		).toBeVisible();
		const table = page.getByRole("table", {
			name: /管理员列表|Administrator list/,
		});
		await expect(table).toBeVisible();
		await expect(
			table.getByText(ADMINISTRATOR.name, { exact: true }),
		).toBeVisible();
		await expect(
			table.getByText(ADMINISTRATOR.email, { exact: true }),
		).toBeVisible();

		const filters = page.getByRole("form", {
			name: /管理员筛选|Administrator filters/,
		});
		await filters.getByLabel(/姓名或邮箱|Name or email/).fill("fixture");
		await filters.getByRole("button", { name: /查询|Search/ }).click();
		await expect
			.poll(() => requestedQueries.at(-1)?.get("query"))
			.toBe("fixture");
		expect(new URL(page.url()).searchParams.get("query")).toBe("fixture");

		const createButton = page.getByRole("button", {
			name: /^(创建|Create)$/,
		});
		await createButton.click();
		const dialog = page.getByRole("dialog");
		await expect(
			dialog.getByRole("heading", { name: /创建管理员|Create administrator/ }),
		).toBeVisible();
		await expect(dialog.getByLabel(/姓名|Name/)).toBeVisible();
		await expect(dialog.getByLabel(/邮箱|Email/)).toBeVisible();
		await expect(
			dialog.getByLabel(/临时密码|Temporary password/),
		).toBeVisible();
		await captureScreenshot(page, testInfo, "administrator-create-dialog.png");
		await page.keyboard.press("Escape");
		await expect(dialog).toHaveCount(0);
		await expect(createButton).toBeFocused();
	});

	test("creates a temporary administrator, enforces first-login password rotation, then revokes and disables it", async ({
		page,
	}) => {
		test.setTimeout(120_000);
		const nonce = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
		const email = `e2e.forced.${nonce}@example.com`;
		const name = `E2E forced password ${nonce}`;
		const temporaryPassword = `Temp9!${nonce}Aa`;
		const permanentPassword = `Final7#${nonce}Zz`;

		try {
			await signIn(page);
			await page.goto("/administrators");
			await page.getByRole("button", { name: /^(创建|Create)$/ }).click();
			const dialog = page.getByRole("dialog");
			await dialog.getByLabel(/^(姓名|Name)$/).fill(name);
			await dialog.getByLabel(/^(邮箱|Email)$/).fill(email);
			await dialog
				.getByLabel(/^(临时密码|Temporary password)$/)
				.fill(temporaryPassword);
			const createResponsePromise = page.waitForResponse((response) => {
				const request = response.request();
				return (
					request.method() === "POST" &&
					new URL(response.url()).pathname === "/api/v1/administrators"
				);
			});
			await dialog.getByRole("button", { name: /^(创建|Create)$/ }).click();
			const createResponse = await createResponsePromise;
			expect(createResponse.status()).toBe(201);
			const created = (await createResponse.json()) as AdministratorDto;
			expect(created).toMatchObject({
				email,
				enabled: true,
				mustChangePassword: true,
				name,
			});
			await expect(dialog).toHaveCount(0);

			await signOutViaUi(page);
			await submitSignIn(page, email, temporaryPassword);
			await expect(
				page.getByRole("heading", {
					level: 1,
					name: /^(修改密码|Change password)$/,
				}),
			).toBeVisible();
			await page
				.getByLabel(/^(当前密码|Current password)$/)
				.fill(temporaryPassword);
			await page.getByLabel(/^(新密码|New password)$/).fill(permanentPassword);
			await page
				.getByLabel(/^(确认新密码|Confirm new password)$/)
				.fill(permanentPassword);
			await page
				.getByRole("button", {
					name: /修改密码并重新登录|Change password and sign in again/,
				})
				.click();
			await expect.poll(() => new URL(page.url()).pathname).toBe("/programs");
			await expect(
				page.getByRole("heading", { level: 1, name: /程序|Programs/ }),
			).toBeVisible();

			await signOutViaUi(page);
			await signIn(page);
			const current = await findAdministrator(page, email);
			if (!current) throw new Error("Temporary administrator was not found.");
			const revokeResponse = await revokeAdministratorSessions(
				page,
				current.id,
			);
			expect(revokeResponse.status()).toBe(200);
			expect(await revokeResponse.json()).toEqual({ success: true });
			const disableResponse = await disableAdministrator(page, current);
			expect(disableResponse.status()).toBe(200);
			expect(await disableResponse.json()).toMatchObject({
				email,
				enabled: false,
			});
		} finally {
			await bestEffortDisableAdministrator(page, email);
		}
	});
});
