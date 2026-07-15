import { describe, expect, it } from "vitest";

import { resolveBrowserSentryEnvironment } from "../build/sentry-environment";

describe("browser Sentry build environment", () => {
	it("prefers SENTRY_ENVIRONMENT, then Netlify CONTEXT, then Vite mode", () => {
		expect(
			resolveBrowserSentryEnvironment("production", {
				CONTEXT: "deploy-preview",
				SENTRY_ENVIRONMENT: " preview-custom ",
			}),
		).toBe("preview-custom");
		expect(
			resolveBrowserSentryEnvironment("production", {
				CONTEXT: " deploy-preview ",
			}),
		).toBe("deploy-preview");
		expect(resolveBrowserSentryEnvironment("development", {})).toBe(
			"development",
		);
	});
});
