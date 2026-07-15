import process from "node:process";
import { defineConfig, devices } from "@playwright/test";

const e2ePort = Number(process.env.E2E_PORT ?? 3187);
if (!Number.isSafeInteger(e2ePort) || e2ePort < 1024 || e2ePort > 65_535) {
	throw new TypeError("E2E_PORT must be an integer between 1024 and 65535.");
}
const baseURL = `http://127.0.0.1:${e2ePort}`;

export default defineConfig({
	testDir: "./tests/e2e",
	forbidOnly: Boolean(process.env.CI),
	retries: process.env.CI ? 2 : 0,
	workers: process.env.CI ? 1 : undefined,
	use: {
		baseURL,
		trace: "on-first-retry",
	},
	projects: [
		{
			name: "chromium-desktop",
			use: {
				...devices["Desktop Chrome"],
				viewport: { height: 1080, width: 1920 },
			},
		},
		{
			name: "chromium-mobile",
			use: {
				...devices["Pixel 7"],
				viewport: { height: 844, width: 390 },
			},
		},
	],
	webServer: {
		command: `pnpm exec vite dev --host 127.0.0.1 --port ${e2ePort} --strictPort`,
		env: {
			BETTER_AUTH_SECRET:
				process.env.BETTER_AUTH_SECRET ??
				"local-playwright-only-Auth9!Qz7#Kp4$Mx2",
			BETTER_AUTH_URL: baseURL,
			DATABASE_URL:
				process.env.DATABASE_URL ?? "postgresql://localhost:9/updater_e2e",
			NETLIFY_DEV: "true",
		},
		url: `${baseURL}/health`,
		reuseExistingServer: false,
	},
});
