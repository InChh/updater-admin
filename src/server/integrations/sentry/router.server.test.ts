import { describe, expect, it, vi } from "vitest";

import {
	captureServerRouterException,
	runWithServerRouterSentryRequest,
	waitForServerRouterExceptions,
} from "./router.server";

describe("server Router Sentry boundary", () => {
	it("queues the SSR route capture for the owning request lifecycle", async () => {
		let finishCapture: (() => void) | undefined;
		const captureException = vi.fn(
			() =>
				new Promise<void>((resolve) => {
					finishCapture = resolve;
				}),
		);
		const error = new Error("SSR failed");
		const request = new Request(
			"https://admin.example.com/programs/3a1c5d9c-db70-4b51-9034-5678a3a6bde3/versions?tab=files",
		);

		runWithServerRouterSentryRequest(request, () => {
			captureServerRouterException(error, {
				captureException,
				generateRequestId: () => "req_router-test",
			});
		});

		expect(captureException).toHaveBeenCalledOnce();
		expect(captureException).toHaveBeenCalledWith(error, {
			requestId: "req_router-test",
			route: "/programs/3a1c5d9c-db70-4b51-9034-5678a3a6bde3/versions",
		});

		let lifecycleFinished = false;
		const lifecycle = waitForServerRouterExceptions(request).then(() => {
			lifecycleFinished = true;
		});
		await Promise.resolve();
		expect(lifecycleFinished).toBe(false);
		finishCapture?.();
		await lifecycle;
		expect(lifecycleFinished).toBe(true);
	});

	it("does not let a reporter outage replace the Router boundary", async () => {
		const request = new Request("https://admin.example.com/programs");
		captureServerRouterException(new Error("SSR failed"), {
			captureException: vi.fn(async () => {
				throw new Error("Sentry unavailable");
			}),
			generateRequestId: () => "req_router-test",
			readRequest: () => request,
		});

		await expect(
			waitForServerRouterExceptions(request),
		).resolves.toBeUndefined();
	});

	it("reuses only bounded request IDs supplied by the request", async () => {
		const captureException = vi.fn(async () => undefined);
		const generateRequestId = vi.fn(() => "req_generated");
		const request = new Request("https://admin.example.com/programs", {
			headers: { "x-request-id": "req_edge-correlation.1" },
		});

		captureServerRouterException(new Error("SSR failed"), {
			captureException,
			generateRequestId,
			readRequest: () => request,
		});
		await waitForServerRouterExceptions(request);

		expect(generateRequestId).not.toHaveBeenCalled();
		expect(captureException).toHaveBeenCalledWith(expect.any(Error), {
			requestId: "req_edge-correlation.1",
			route: "/programs",
		});

		const invalidRequest = new Request("https://admin.example.com/programs", {
			headers: { "x-request-id": `req_${"x".repeat(129)}` },
		});
		captureServerRouterException(new Error("SSR failed again"), {
			captureException,
			generateRequestId,
			readRequest: () => invalidRequest,
		});
		await waitForServerRouterExceptions(invalidRequest);
		expect(generateRequestId).toHaveBeenCalledOnce();
		expect(captureException).toHaveBeenLastCalledWith(expect.any(Error), {
			requestId: "req_generated",
			route: "/programs",
		});
	});
});
