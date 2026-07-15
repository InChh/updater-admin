import { describe, expect, it } from "vitest";

import {
	SECURITY_RESPONSE_HEADERS,
	withSecurityResponseHeaders,
} from "./headers";

describe("dynamic response security headers", () => {
	it("adds the shared policy while preserving status, body, and existing headers", async () => {
		const response = withSecurityResponseHeaders(
			new Response("ok", {
				headers: { "cache-control": "no-store" },
				status: 202,
			}),
		);

		expect(response.status).toBe(202);
		expect(await response.text()).toBe("ok");
		expect(response.headers.get("cache-control")).toBe("no-store");
		for (const [name, value] of Object.entries(SECURITY_RESPONSE_HEADERS)) {
			expect(response.headers.get(name)).toBe(value);
		}
	});
});
