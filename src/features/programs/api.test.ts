import { afterEach, describe, expect, it, vi } from "vitest";

import { canonicalProgramDescription, createProgram } from "./api";

const PROGRAM_ID = "ca6f79db-c7c4-4a34-9ab5-2a85ca9df501";

afterEach(() => vi.unstubAllGlobals());

describe("program API normalization", () => {
	it("canonicalizes blank descriptions to null at the transport boundary", async () => {
		const fetcher = vi.fn(
			async (_input: RequestInfo | URL, _init?: RequestInit) =>
				new Response(
					JSON.stringify({
						createdAt: "2026-07-15T00:00:00.000Z",
						description: null,
						id: PROGRAM_ID,
						name: "Release service",
						updatedAt: "2026-07-15T00:00:00.000Z",
						versionCount: 0,
					}),
					{
						headers: {
							"content-type": "application/json",
							etag: 'W/"1"',
						},
						status: 201,
					},
				),
		);
		vi.stubGlobal("fetch", fetcher);

		await createProgram({
			description: "   ",
			name: "  Release service  ",
		});

		const [, init] = fetcher.mock.calls[0] ?? [];
		expect(JSON.parse(String(init?.body))).toEqual({
			description: null,
			name: "Release service",
		});
		expect(canonicalProgramDescription("  Stable channel  ")).toBe(
			"Stable channel",
		);
	});
});
