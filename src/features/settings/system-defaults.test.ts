import { describe, expect, it } from "vitest";

import { applySystemDefaultPageSize } from "./system-defaults";

describe("system list defaults", () => {
	it("uses the Query-backed system default when pageSize is absent", () => {
		expect(
			applySystemDefaultPageSize({ page: 1, sort: "createdAt:desc" }, 50),
		).toEqual({ page: 1, pageSize: 50, sort: "createdAt:desc" });
	});

	it("keeps explicit URL state authoritative", () => {
		expect(
			applySystemDefaultPageSize(
				{ page: 2, pageSize: 20, sort: "createdAt:desc" },
				100,
			),
		).toEqual({ page: 2, pageSize: 20, sort: "createdAt:desc" });
	});
});
