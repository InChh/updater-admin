import { expect, test } from "@playwright/test";

test.describe("public health and authentication boundaries", () => {
	test("keeps health public and returns an unauthenticated Problem from the API", async ({
		request,
	}) => {
		const health = await request.get("/health", {
			headers: { "x-request-id": "e2e-health-must-not-be-used" },
		});
		expect(health.status()).toBe(200);
		expect(health.headers()["content-type"]).toMatch(/^application\/json/);
		expect(health.headers()["x-request-id"]).toBeUndefined();
		expect(await health.json()).toEqual({ status: "ok" });

		const requestId = "e2e-anonymous-api";
		const protectedResponse = await request.get(
			"/api/v1/programs?page=1&pageSize=20&sort=createdAt%3Adesc",
			{ headers: { "x-request-id": requestId } },
		);
		expect(protectedResponse.status()).toBe(401);
		expect(protectedResponse.headers()["cache-control"]).toBe("no-store");
		expect(protectedResponse.headers()["content-type"]).toMatch(
			/^application\/problem\+json/,
		);
		expect(protectedResponse.headers()["x-request-id"]).toBe(requestId);
		expect(await protectedResponse.json()).toEqual({
			code: "UNAUTHENTICATED",
			requestId,
			status: 401,
			title: "Authentication is required",
			type: "https://updater-admin.local/problems/unauthenticated",
		});
	});

	test("routes the anonymous root to login with the canonical programs return target", async ({
		page,
	}) => {
		const response = await page.goto("/");

		await expect(page).toHaveURL(/\/login\?/);
		expect(response).not.toBeNull();
		expect(response?.url()).toContain("/login?");
		expect(response?.headers()).toMatchObject({
			"permissions-policy": "camera=(), microphone=(), geolocation=()",
			"referrer-policy": "strict-origin-when-cross-origin",
			"x-content-type-options": "nosniff",
			"x-frame-options": "DENY",
		});
		const destination = new URL(page.url());
		expect(destination.pathname).toBe("/login");
		expect(destination.searchParams.get("returnTo")).toBe(
			"/programs?page=1&sort=createdAt%3Adesc",
		);
		await expect(
			page.getByRole("heading", { level: 1, name: /登录|Sign in/ }),
		).toBeVisible();
		await expect(page.getByText(/Dashboard/i)).toHaveCount(0);
	});

	test("preserves a registered protected URL as the anonymous return target", async ({
		page,
	}) => {
		const returnTo =
			"/monitoring/audit?page=4&pageSize=50&sort=createdAt%3Aasc";
		await page.goto(returnTo);

		await expect(page).toHaveURL(/\/login\?/);
		const destination = new URL(page.url());
		expect(destination.pathname).toBe("/login");
		expect(destination.searchParams.get("returnTo")).toBe(returnTo);
		await expect(
			page.getByRole("heading", { level: 1, name: /登录|Sign in/ }),
		).toBeVisible();
	});
});
