import { describe, expect, it } from "vitest";

import {
	administratorListLoaderDeps,
	administratorListSearch,
	closeAdministratorDialog,
	openAdministratorDialog,
	openCreateAdministratorDialog,
	validateAdministratorRouteSearch,
} from "./search";

const ADMINISTRATOR_ID = "ca6f79db-c7c4-4a34-9ab5-2a85ca9df501";

describe("administrator route search", () => {
	it("normalizes bounded list filters and rejects unknown values", () => {
		expect(
			validateAdministratorRouteSearch({
				page: "3",
				pageSize: "50",
				query: "  admin@example.com  ",
				sort: "name:asc",
				status: "disabled",
			}),
		).toEqual({
			page: 3,
			pageSize: 50,
			query: "admin@example.com",
			sort: "name:asc",
			status: "disabled",
		});
		expect(
			validateAdministratorRouteSearch({
				page: -1,
				pageSize: 25,
				query: "x".repeat(321),
				sort: "email:asc",
				status: "pending",
			}),
		).toEqual({ page: 1, pageSize: 20, sort: "createdAt:desc" });
	});

	it("preserves omitted pageSize while normalizing explicit invalid input", () => {
		const omitted = validateAdministratorRouteSearch({
			page: 1,
			sort: "createdAt:desc",
		});
		expect(omitted).not.toHaveProperty("pageSize");
		expect(administratorListLoaderDeps(omitted)).not.toHaveProperty("pageSize");
		expect(
			validateAdministratorRouteSearch({
				page: 1,
				pageSize: undefined,
				sort: "createdAt:desc",
			}),
		).toMatchObject({ pageSize: 20 });
	});

	it("keeps only canonical dialog and administrator pairs", () => {
		expect(
			validateAdministratorRouteSearch({
				administratorId: ADMINISTRATOR_ID,
				dialog: "reset",
			}),
		).toEqual({
			administratorId: ADMINISTRATOR_ID,
			dialog: "reset",
			page: 1,
			sort: "createdAt:desc",
		});
		expect(
			validateAdministratorRouteSearch({
				administratorId: "../other",
				dialog: "disable",
			}),
		).toEqual({ page: 1, sort: "createdAt:desc" });
	});

	it("preserves filters while opening and closing dialogs", () => {
		const list = {
			page: 2,
			pageSize: 50,
			query: "admin",
			sort: "name:desc",
			status: "active",
		} as const;
		const create = openCreateAdministratorDialog(list);
		expect(create).toEqual({ ...list, dialog: "create" });
		expect(closeAdministratorDialog(create)).toEqual(list);
		const reset = openAdministratorDialog(list, "reset", ADMINISTRATOR_ID);
		expect(administratorListSearch(reset)).toEqual(list);
		expect(() => openAdministratorDialog(list, "reset", "bad-id")).toThrow(
			"Invalid administrator ID",
		);
	});
});
