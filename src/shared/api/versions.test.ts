import { describe, expect, it } from "vitest";

import {
	type CreateVersionInput,
	type SetVersionActivationInput,
	type UpdateVersionInput,
	VERSION_MAX_PAGE,
	VERSION_PAGE_SIZES,
	VERSION_SORTS,
} from "./versions";

describe("version API contract", () => {
	it("keeps sort and page-size values closed over the approved set", () => {
		expect(VERSION_SORTS).toEqual(["createdAt:desc", "createdAt:asc"]);
		expect(VERSION_PAGE_SIZES).toEqual([20, 50, 100]);
		expect(VERSION_MAX_PAGE).toBe(1_000_000);
	});

	it("requires the file set field when creating a version", () => {
		const input: CreateVersionInput = {
			fileIds: ["file-1"],
			versionNumber: "1.2.3",
		};
		// Runtime schema/domain validation owns the non-empty constraint.
		const emptyFiles: CreateVersionInput = {
			fileIds: [],
			versionNumber: "1.2.3",
		};
		// @ts-expect-error The required fileIds field cannot be omitted on create.
		const missingFiles: CreateVersionInput = { versionNumber: "1.2.3" };

		expect(input.fileIds).toEqual(["file-1"]);
		expect(emptyFiles.fileIds).toEqual([]);
		expect(missingFiles).toEqual({ versionNumber: "1.2.3" });
	});

	it("distinguishes omitted, empty, and populated file replacement patches", () => {
		const preserveRelations: UpdateVersionInput = {
			description: "metadata only",
		};
		const removeEveryRelation: UpdateVersionInput = { fileIds: [] };
		const replaceRelations: UpdateVersionInput = {
			fileIds: ["file-2", "file-3"],
		};
		// @ts-expect-error An update must include a mutable field.
		const empty: UpdateVersionInput = {};

		expect("fileIds" in preserveRelations).toBe(false);
		expect(removeEveryRelation.fileIds).toEqual([]);
		expect(replaceRelations.fileIds).toEqual(["file-2", "file-3"]);
		expect(empty).toEqual({});
	});

	it("uses an explicit boolean activation body", () => {
		const input: SetVersionActivationInput = { isActive: false };
		expect(input).toEqual({ isActive: false });
	});
});
