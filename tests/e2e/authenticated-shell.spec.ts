import { expect, test } from "@playwright/test";

const email = process.env.E2E_ADMIN_EMAIL;
const password = process.env.E2E_ADMIN_PASSWORD;
const hasCredentials = Boolean(email && password);

test("redirects an anonymous protected route through the real Router guard", async ({
	page,
}) => {
	await page.goto("/administrators");
	await expect(page).toHaveURL(/\/login\?returnTo=%2Fadministrators$/);
	await expect(page.getByRole("heading", { name: /登录|Sign in/ })).toBeVisible();
	await expect(page.getByText(/Dashboard/i)).toHaveCount(0);
});

test.describe("authenticated administration shell", () => {
	test.skip(
		!hasCredentials,
		"E2E_ADMIN_EMAIL and E2E_ADMIN_PASSWORD are required for authenticated E2E coverage.",
	);

	test("signs in, opens protected routes, and retains dynamic tabs", async ({
		page,
	}) => {
		await page.goto("/login?returnTo=%2Fprograms");
		await page.getByLabel(/邮箱|Email/).fill(email ?? "");
		await page.getByLabel(/密码|Password/).fill(password ?? "");
		await page.getByRole("button", { name: /登录|Sign in/ }).click();

		await expect(page).toHaveURL(/\/programs$/);
		await expect(page.getByRole("main")).toBeVisible();

		for (const path of [
			"/administrators",
			"/monitoring/overview",
			"/monitoring/audit",
			"/settings/profile",
		]) {
			await page.goto(path);
			await expect(page).toHaveURL(new RegExp(`${path}$`));
			await expect(page.getByRole("main")).toBeVisible();
		}

		expect(await page.getByRole("tab").count()).toBeGreaterThanOrEqual(4);
	});
});
