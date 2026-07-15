import { expect, type Page, type Route, type TestInfo } from "@playwright/test";

export const E2E_ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL;
export const E2E_ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD;
export const HAS_E2E_ADMIN_CREDENTIALS = Boolean(
	E2E_ADMIN_EMAIL && E2E_ADMIN_PASSWORD,
);
export const AUTHENTICATED_E2E_SKIP_REASON =
	"E2E_ADMIN_EMAIL and E2E_ADMIN_PASSWORD are required for authenticated E2E coverage.";

export async function submitSignIn(
	page: Page,
	email: string,
	password: string,
	returnTo = "/programs",
): Promise<void> {
	const parameters = new URLSearchParams({ returnTo });
	await page.goto(`/login?${parameters.toString()}`);
	await page.getByLabel(/邮箱|Email/).fill(email);
	await page.getByLabel(/密码|Password/).fill(password);
	await page.getByRole("button", { name: /登录|Sign in/ }).click();
}

export async function signIn(
	page: Page,
	returnTo = "/programs",
): Promise<void> {
	await submitSignIn(
		page,
		E2E_ADMIN_EMAIL ?? "",
		E2E_ADMIN_PASSWORD ?? "",
		returnTo,
	);

	const expectedPath = new URL(returnTo, "http://updater-admin.invalid")
		.pathname;
	await expect.poll(() => new URL(page.url()).pathname).toBe(expectedPath);
}

export async function captureScreenshot(
	page: Page,
	testInfo: TestInfo,
	fileName: string,
): Promise<void> {
	const path = testInfo.outputPath(fileName);
	await page.screenshot({ animations: "disabled", fullPage: true, path });
	await testInfo.attach(fileName, { contentType: "image/png", path });
}

export async function fulfillJson(
	route: Route,
	body: unknown,
	options: {
		readonly etag?: string;
		readonly headers?: Readonly<Record<string, string>>;
		readonly status?: number;
	} = {},
): Promise<void> {
	await route.fulfill({
		body: JSON.stringify(body),
		contentType:
			options.status && options.status >= 400
				? "application/problem+json"
				: "application/json",
		headers: {
			...(options.etag ? { etag: options.etag } : {}),
			...options.headers,
		},
		status: options.status ?? 200,
	});
}

export function parseRequestBody(
	value: string | null,
): Record<string, unknown> {
	if (!value) return {};
	const parsed: unknown = JSON.parse(value);
	return parsed && typeof parsed === "object" && !Array.isArray(parsed)
		? (parsed as Record<string, unknown>)
		: {};
}
