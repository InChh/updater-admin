import { describe, expect, it } from "vitest";

import {
	PROGRAM_MAX_PAGE,
	PROGRAM_PAGE_SIZES,
	PROGRAM_SORTS,
	type UpdateProgramInput,
} from "./programs";

describe("program API contract", () => {
	it("keeps sort and page-size values closed over the approved set", () => {
		expect(PROGRAM_SORTS).toEqual(["createdAt:desc", "createdAt:asc"]);
		expect(PROGRAM_PAGE_SIZES).toEqual([20, 50, 100]);
		expect(PROGRAM_MAX_PAGE).toBe(1_000_000);
	});

	it("accepts either mutable field while the type rejects an empty patch", () => {
		const nameOnly: UpdateProgramInput = { name: "Updater" };
		const descriptionOnly: UpdateProgramInput = { description: null };
		// @ts-expect-error An update must include name or description.
		const empty: UpdateProgramInput = {};

		expect(nameOnly).toEqual({ name: "Updater" });
		expect(descriptionOnly).toEqual({ description: null });
		expect(empty).toEqual({});
	});
});
