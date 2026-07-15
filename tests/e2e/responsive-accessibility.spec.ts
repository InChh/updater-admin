import { expect, test } from "@playwright/test";

import {
	AUTHENTICATED_E2E_SKIP_REASON,
	captureScreenshot,
	HAS_E2E_ADMIN_CREDENTIALS,
	signIn,
} from "./support";

test("keeps the login surface labelled, keyboard reachable, and viewport safe", async ({
	page,
}) => {
	await page.goto("/login?returnTo=%2Fprograms");

	const skipLink = page.getByRole("link", {
		name: /跳到主要内容|Skip to main content/,
	});
	await expect(skipLink).toBeAttached();
	await skipLink.focus();
	await expect(skipLink).toBeFocused();
	await expect(skipLink).toHaveAttribute("href", "#main-content");

	const heading = page.getByRole("heading", {
		level: 1,
		name: /登录|Sign in/,
	});
	const email = page.getByLabel(/邮箱|Email/);
	const password = page.getByLabel(/密码|Password/);
	const submit = page.getByRole("button", { name: /登录|Sign in/ });
	await expect(heading).toBeVisible();
	await expect(email).toHaveAttribute("autocomplete", "username");
	await expect(password).toHaveAttribute("autocomplete", "current-password");

	await email.focus();
	await page.keyboard.type("keyboard@example.com");
	await page.keyboard.press("Tab");
	await expect(password).toBeFocused();
	await page.keyboard.type("keyboard-only-password");
	await page.keyboard.press("Tab");
	await expect(submit).toBeFocused();

	const overflow = await page.evaluate(() => ({
		clientWidth: document.documentElement.clientWidth,
		scrollWidth: document.documentElement.scrollWidth,
	}));
	expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth + 1);
});

test.describe("authenticated responsive shell", () => {
	test.skip(!HAS_E2E_ADMIN_CREDENTIALS, AUTHENTICATED_E2E_SKIP_REASON);

	test("opens the mobile navigation drawer and closes it after navigation", async ({
		page,
	}, testInfo) => {
		test.skip(
			testInfo.project.name !== "chromium-mobile",
			"The mobile navigation drawer is exercised only by the mobile Playwright project.",
		);

		await signIn(page);
		const openNavigation = page.getByRole("button", {
			name: /打开导航菜单|Open navigation/,
		});
		await expect(openNavigation).toBeVisible();
		await captureScreenshot(page, testInfo, "mobile-shell.png");
		await openNavigation.click();

		const drawer = page.getByRole("dialog", { name: /管理|Management/ });
		await expect(drawer).toBeVisible();
		await captureScreenshot(page, testInfo, "mobile-navigation-drawer.png");
		await expect(
			drawer.getByRole("link", { name: /程序|Programs/ }),
		).toBeVisible();
		await drawer.getByRole("link", { name: /管理员|Administrators/ }).click();

		await expect
			.poll(() => new URL(page.url()).pathname)
			.toBe("/administrators");
		await expect(drawer).toHaveCount(0);
		await expect(
			page.getByRole("heading", { level: 1, name: /管理员|Administrators/ }),
		).toBeVisible();
	});
});
