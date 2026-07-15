import { expect, test } from "@playwright/test";

import {
	AUTHENTICATED_E2E_SKIP_REASON,
	HAS_E2E_ADMIN_CREDENTIALS,
	signIn,
} from "./support";

test.describe("authenticated administration shell", () => {
	test.skip(!HAS_E2E_ADMIN_CREDENTIALS, AUTHENTICATED_E2E_SKIP_REASON);

	test("opens every read-only administration route and restores dynamic tabs after reload", async ({
		page,
	}) => {
		await signIn(page);
		await expect(page.getByRole("tabpanel")).toBeVisible();

		const routes = [
			{ heading: /管理员|Administrators/, path: "/administrators" },
			{ heading: /监控概览|Monitoring overview/, path: "/monitoring/overview" },
			{ heading: /审计记录|Audit events/, path: "/monitoring/audit" },
			{ heading: /个人资料|Profile/, path: "/settings/profile" },
			{ heading: /账户设置|Account settings/, path: "/settings/account" },
			{ heading: /系统设置|System settings/, path: "/settings/system" },
		] as const;

		for (const { heading, path } of routes) {
			await page.goto(path);
			expect(new URL(page.url()).pathname).toBe(path);
			await expect(page.getByRole("tabpanel")).toBeVisible();
			await expect(
				page.getByRole("heading", { level: 1, name: heading }),
			).toBeVisible();
		}

		const tabList = page.getByRole("tablist");
		await expect(tabList).toBeVisible();
		await expect.poll(() => page.getByRole("tab").count()).toBe(7);

		await page.reload();
		await expect(page.getByRole("tabpanel")).toBeVisible();
		await expect.poll(() => page.getByRole("tab").count()).toBe(7);
		await expect(
			page.getByRole("tab", { name: /程序|Programs/, exact: true }),
		).toHaveAttribute("aria-selected", "false");
		await expect(
			page.getByRole("tab", { name: /系统设置|System settings/ }),
		).toHaveAttribute("aria-selected", "true");
	});
});
