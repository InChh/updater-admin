import { describe, expect, it, vi } from "vitest";

const { captureBrowserException } = vi.hoisted(() => ({
	captureBrowserException: vi.fn(),
}));

vi.mock("../../lib/sentry", () => ({ captureBrowserException }));

import { createApplicationQueryClient } from "./provider";

describe("TanStack Query observability", () => {
	it("reports rejected mutations through the browser Sentry boundary", () => {
		const client = createApplicationQueryClient();
		const error = new Error("mutation failed");

		client
			.getMutationCache()
			.config.onError?.(error, undefined, undefined, {} as never, {} as never);

		expect(captureBrowserException).toHaveBeenCalledOnce();
		expect(captureBrowserException).toHaveBeenCalledWith(error);
	});
});
