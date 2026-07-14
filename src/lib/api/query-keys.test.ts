import { describe, expect, it } from "vitest";

import {
	normalizeProgramListSearch,
	programQueryKeys,
	queryKeys,
} from "./query-keys";

describe("program query keys", () => {
	it("provides stable list and detail prefix keys", () => {
		expect(programQueryKeys.all).toEqual(["programs"]);
		expect(programQueryKeys.lists()).toEqual(["programs", "list"]);
		expect(programQueryKeys.details()).toEqual(["programs", "detail"]);
		expect(programQueryKeys.detail("program-1")).toEqual([
			"programs",
			"detail",
			"program-1",
		]);
		expect(queryKeys.programs).toBe(programQueryKeys);
	});

	it("normalizes semantically equivalent searches into structural keys", () => {
		const blankName = programQueryKeys.list({
			name: "  ",
			page: 1,
			pageSize: 20,
			sort: "createdAt:desc",
		});
		const omittedName = programQueryKeys.list({
			page: 1,
			pageSize: 20,
			sort: "createdAt:desc",
		});

		expect(blankName).toEqual(omittedName);
		expect(
			programQueryKeys.list({
				name: "  Release Agent  ",
				page: 2,
				pageSize: 50,
				sort: "createdAt:asc",
			}),
		).toEqual([
			"programs",
			"list",
			{
				name: "Release Agent",
				page: 2,
				pageSize: 50,
				sort: "createdAt:asc",
			},
		]);
	});

	it("fails closed to list defaults if untrusted search bypasses route parsing", () => {
		expect(
			normalizeProgramListSearch({
				page: Number.NaN,
				pageSize: 999 as 20,
				sort: "untrusted" as "createdAt:desc",
			}),
		).toEqual({
			name: null,
			page: 1,
			pageSize: 20,
			sort: "createdAt:desc",
		});
		expect(
			normalizeProgramListSearch({
				page: 1_000_001,
				pageSize: 20,
				sort: "createdAt:desc",
			}),
		).toMatchObject({ page: 1 });
	});
});
