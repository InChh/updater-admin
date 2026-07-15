import { describe, expect, it } from "vitest";

import {
	closeVersionDialog,
	openCreateVersionDialog,
	openVersionDialog,
	parseProgramVersionsParams,
	validateVersionRouteSearch,
	versionListLoaderDeps,
	versionListSearch,
	versionSearchAfterDelete,
} from "./search";

const PROGRAM_ID = "ca6f79db-c7c4-4a34-9ab5-2a85ca9df501";
const VERSION_ID = "31ddcbe4-4a31-4c35-9738-e88d974a20f4";

describe("version route params and search", () => {
	it("accepts only canonical lowercase UUID program params", () => {
		expect(parseProgramVersionsParams({ programId: PROGRAM_ID })).toEqual({
			programId: PROGRAM_ID,
		});
		expect(
			parseProgramVersionsParams({ programId: PROGRAM_ID.toUpperCase() }),
		).toBe(false);
		expect(parseProgramVersionsParams({ programId: "not-a-uuid" })).toBe(false);
	});

	it("preserves omitted pageSize while normalizing explicit invalid input", () => {
		const omitted = validateVersionRouteSearch({
			page: 1,
			sort: "createdAt:desc",
		});
		expect(omitted).not.toHaveProperty("pageSize");
		expect(versionListLoaderDeps(omitted)).not.toHaveProperty("pageSize");
		expect(
			validateVersionRouteSearch({
				page: 1,
				pageSize: undefined,
				sort: "createdAt:desc",
			}),
		).toMatchObject({ pageSize: 20 });
	});

	it("normalizes pagination and sort inputs", () => {
		expect(
			validateVersionRouteSearch({
				page: "3",
				pageSize: "50",
				sort: "createdAt:asc",
			}),
		).toEqual({ page: 3, pageSize: 50, sort: "createdAt:asc" });

		expect(
			validateVersionRouteSearch({
				page: 1_000_001,
				pageSize: 25,
				sort: "versionNumber:desc",
			}),
		).toEqual({ page: 1, pageSize: 20, sort: "createdAt:desc" });
	});

	it("retains only version IDs required by edit and delete dialogs", () => {
		const base = {
			page: 2,
			pageSize: 100,
			sort: "createdAt:desc",
		} as const;
		expect(openCreateVersionDialog(base)).toEqual({
			dialog: "create",
			page: 2,
			pageSize: 100,
			sort: "createdAt:desc",
		});
		const edit = openVersionDialog(base, "edit", VERSION_ID);
		expect(edit).toMatchObject({ dialog: "edit", versionId: VERSION_ID });
		expect(closeVersionDialog(edit)).toEqual(versionListSearch(base));

		expect(
			validateVersionRouteSearch({
				dialog: "delete",
				versionId: "invalid",
			}),
		).toEqual({ page: 1, sort: "createdAt:desc" });
	});

	it("decrements only the final occupied page after delete", () => {
		const deleting = openVersionDialog(
			{
				page: 3,
				pageSize: 20,
				sort: "createdAt:desc",
			},
			"delete",
			VERSION_ID,
		);

		expect(versionSearchAfterDelete(deleting, 1)).toMatchObject({ page: 2 });
		expect(versionSearchAfterDelete(deleting, 2)).toMatchObject({ page: 3 });
	});
});
