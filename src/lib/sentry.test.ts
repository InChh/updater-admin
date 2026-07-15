import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { loadBrowserSentry } = vi.hoisted(() => ({
	loadBrowserSentry: vi.fn(),
}));

vi.mock("@tanstack/solid-start", () => ({
	createClientOnlyFn: () => loadBrowserSentry,
	createIsomorphicFn: () => {
		let serverImplementation: ((...args: never[]) => unknown) | undefined;
		const implementation = (...args: never[]) =>
			serverImplementation?.(...args);
		return Object.assign(implementation, {
			client: () => implementation,
			server: (nextServerImplementation: (...args: never[]) => unknown) => {
				serverImplementation = nextServerImplementation;
				return implementation;
			},
		});
	},
}));

import {
	captureBrowserException,
	captureRouteException,
	hasBrowserSentryDsn,
	initializeBrowserSentry,
	registerServerRouteExceptionHandler,
	setBrowserSentryActor,
	setBrowserSentryRoute,
} from "./sentry";

describe("browser Sentry client-only boundary", () => {
	beforeEach(() => {
		loadBrowserSentry.mockReset();
	});

	afterEach(() => {
		vi.unstubAllEnvs();
	});

	it("treats only non-empty string DSNs as configured", () => {
		expect(hasBrowserSentryDsn(undefined)).toBe(false);
		expect(hasBrowserSentryDsn(null)).toBe(false);
		expect(hasBrowserSentryDsn("   ")).toBe(false);
		expect(hasBrowserSentryDsn("https://public@example.invalid/1")).toBe(true);
	});

	it("does not load the browser SDK when VITE_SENTRY_DSN is absent", async () => {
		vi.stubEnv("VITE_SENTRY_DSN", "");
		await expect(initializeBrowserSentry()).resolves.toBe(false);
		expect(loadBrowserSentry).not.toHaveBeenCalled();
	});

	it("contains browser SDK loader failures during initialization", async () => {
		vi.stubEnv("VITE_SENTRY_DSN", "https://public@example.invalid/1");
		loadBrowserSentry.mockRejectedValueOnce(new Error("chunk unavailable"));

		await expect(initializeBrowserSentry()).resolves.toBe(false);
	});

	it("forwards opaque actor lifecycle values through the client boundary", async () => {
		vi.stubEnv("VITE_SENTRY_DSN", "https://public@example.invalid/1");
		const setActor = vi.fn();
		loadBrowserSentry.mockResolvedValue({
			setBrowserSentryActor: setActor,
		});

		setBrowserSentryActor("admin_opaque-1");
		setBrowserSentryActor(null);

		await vi.waitFor(() => expect(setActor).toHaveBeenCalledTimes(2));
		expect(setActor).toHaveBeenNthCalledWith(1, "admin_opaque-1");
		expect(setActor).toHaveBeenNthCalledWith(2, null);
	});

	it("contains rejected fire-and-forget browser reporting promises", async () => {
		vi.stubEnv("VITE_SENTRY_DSN", "https://public@example.invalid/1");
		loadBrowserSentry.mockRejectedValue(new Error("chunk unavailable"));

		setBrowserSentryRoute("/programs");
		setBrowserSentryActor("admin_opaque-1");
		captureBrowserException(new Error("render failed"));

		await vi.waitFor(() => expect(loadBrowserSentry).toHaveBeenCalledTimes(3));
	});

	it("routes SSR boundary failures synchronously to the registered server reporter", () => {
		const captureServerRouterException = vi.fn();
		const error = new Error("SSR failed");
		registerServerRouteExceptionHandler(captureServerRouterException);

		captureRouteException(error);

		expect(captureServerRouterException).toHaveBeenCalledOnce();
		expect(captureServerRouterException).toHaveBeenCalledWith(error);
	});
});
