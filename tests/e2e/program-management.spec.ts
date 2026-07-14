import { expect, test } from "@playwright/test";

const email = process.env.E2E_ADMIN_EMAIL;
const password = process.env.E2E_ADMIN_PASSWORD;
const hasCredentials = Boolean(email && password);

test.describe("program management", () => {
	test.skip(
		!hasCredentials,
		"E2E_ADMIN_EMAIL and E2E_ADMIN_PASSWORD are required for program CRUD coverage.",
	);

	test("creates, filters, edits, and deletes a program through the real API", async ({
		page,
	}) => {
		const nonce = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
		const originalName = `E2E program ${nonce}`;
		const updatedName = `${originalName} updated`;

		await page.goto("/login?returnTo=%2Fprograms");
		await page.getByLabel(/邮箱|Email/).fill(email ?? "");
		await page.getByLabel(/密码|Password/).fill(password ?? "");
		await page.getByRole("button", { name: /登录|Sign in/ }).click();
		await expect(page).toHaveURL(/\/programs(?:\?.*)?$/);

		await page.getByRole("button", { name: /创建|Create/ }).click();
		const createDialog = page.getByRole("dialog");
		await expect(
			createDialog.getByRole("heading", { name: /创建程序|Create program/ }),
		).toBeVisible();
		await createDialog.getByLabel(/名称|Name/).fill(originalName);
		await createDialog
			.getByLabel(/描述|Description/)
			.fill("Created by the authenticated Playwright CRUD guard.");
		await createDialog
			.getByRole("button", { name: /创建|Create/ })
			.click();
		await expect(page.getByText(originalName, { exact: true })).toBeVisible();

		const filters = page.locator("section").filter({
			has: page.getByRole("textbox", { name: /名称|Name/ }),
		});
		await filters.getByRole("textbox", { name: /名称|Name/ }).fill(originalName);
		await filters.getByRole("button", { name: /查询|Search/ }).click();
		await expect(page).toHaveURL(/name=E2E(?:\+|%20)program/);
		await expect(page.getByText(originalName, { exact: true })).toBeVisible();

		await page
			.getByRole("button", {
				name: new RegExp(`编辑程序 ${originalName}|Edit program ${originalName}`),
			})
			.click();
		const editDialog = page.getByRole("dialog");
		await expect(
			editDialog.getByRole("heading", { name: /编辑程序|Edit program/ }),
		).toBeVisible();
		await editDialog.getByLabel(/名称|Name/).fill(updatedName);
		await editDialog
			.getByRole("button", { name: /保存更改|Save changes/ })
			.click();
		await expect(page.getByText(updatedName, { exact: true })).toBeVisible();

		await page
			.getByRole("button", {
				name: new RegExp(`删除程序 ${updatedName}|Delete program ${updatedName}`),
			})
			.click();
		const deleteDialog = page.getByRole("dialog");
		await expect(
			deleteDialog.getByRole("heading", { name: /删除程序|Delete program/ }),
		).toBeVisible();
		await deleteDialog.getByRole("button", { name: /删除|Delete/ }).click();
		await expect(page.getByText(updatedName, { exact: true })).toHaveCount(0);
	});
});
