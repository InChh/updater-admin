import { describe, expect, it } from "vitest";

import {
	closeProgramDialog,
	openCreateProgramDialog,
	openProgramDialog,
	programListSearch,
	programSearchAfterDelete,
	validateProgramRouteSearch,
} from "./search";

const PROGRAM_ID = "ca6f79db-c7c4-4a34-9ab5-2a85ca9df501";

describe("program route search", () => {
	it("normalizes filter, pagination, and sort inputs", () => {
		expect(
			validateProgramRouteSearch({
				name: "  release  ",
				page: "3",
				pageSize: "50",
				sort: "createdAt:asc",
			}),
		).toEqual({
			name: "release",
			page: 3,
			pageSize: 50,
			sort: "createdAt:asc",
		});
	});

	it("falls back for invalid page, page-size, sort, and dialog values", () => {
		expect(
			validateProgramRouteSearch({
				dialog: "edit",
				page: 0,
				pageSize: 25,
				programId: "not-a-uuid",
				sort: "name:asc",
			}),
		).toEqual({ page: 1, pageSize: 20, sort: "createdAt:desc" });
		expect(
			validateProgramRouteSearch({ name: "🚀".repeat(128) }),
		).toMatchObject({ name: "🚀".repeat(128) });
		expect(
			validateProgramRouteSearch({ name: "🚀".repeat(129) }),
		).not.toHaveProperty("name");
		expect(validateProgramRouteSearch({ page: 1_000_001 })).toMatchObject({
			page: 1,
		});
	});

	it("retains only dialog IDs required by edit and delete", () => {
		const base = validateProgramRouteSearch({
			page: 2,
			pageSize: 20,
			sort: "createdAt:desc",
		});
		expect(openCreateProgramDialog(base)).toEqual({
			dialog: "create",
			page: 2,
			pageSize: 20,
			sort: "createdAt:desc",
		});
		const edit = openProgramDialog(base, "edit", PROGRAM_ID);
		expect(edit).toMatchObject({ dialog: "edit", programId: PROGRAM_ID });
		expect(closeProgramDialog(edit)).toEqual(programListSearch(base));
	});

	it("closes delete state and decrements the last occupied page atomically", () => {
		const deleting = openProgramDialog(
			validateProgramRouteSearch({
				name: "release",
				page: 2,
				pageSize: 20,
				sort: "createdAt:desc",
			}),
			"delete",
			PROGRAM_ID,
		);

		expect(programSearchAfterDelete(deleting, 1)).toEqual({
			name: "release",
			page: 1,
			pageSize: 20,
			sort: "createdAt:desc",
		});
		expect(programSearchAfterDelete({ ...deleting, page: 3 }, 1)).toMatchObject(
			{ page: 2 },
		);
	});
});
