import { describe, expect, it } from "vitest";

import { isCurrentSidebarDestination } from "./sidebar";

describe("sidebar navigation", () => {
	it("treats an exact current menu destination as a no-op", () => {
		expect(
			isCurrentSidebarDestination("/administrators", "/administrators"),
		).toBe(true);
	});

	it("still allows navigation from a nested page to its parent menu", () => {
		expect(
			isCurrentSidebarDestination(
				"/programs/10000000-0000-4000-8000-000000000001/versions",
				"/programs",
			),
		).toBe(false);
	});
});
