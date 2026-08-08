import { describe, expect, it } from "vitest";

import { MAX_UPLOAD_SIZE_BYTES } from "../../shared/api/uploads";
import {
	createFolderSelections,
	type FolderSelectionError,
} from "./folder-picker";

function folderFile(path: string, contents = "release"): File {
	const file = new File([contents], path.split("/").at(-1) ?? "file.bin");
	Object.defineProperty(file, "webkitRelativePath", {
		configurable: true,
		value: path,
	});
	return file;
}

describe("folder picker selection", () => {
	it("preserves File identity while stripping the selected root directory", () => {
		const second = folderFile("release/z.bin");
		const first = folderFile("release/cafe\u0301.bin");

		expect(createFolderSelections([second, first])).toEqual([
			{ file: first, path: "café.bin" },
			{ file: second, path: "z.bin" },
		]);
	});

	it("keeps nested paths relative to the selected root", () => {
		const file = folderFile("selected-root/group/nested/file.bin");

		expect(createFolderSelections([file])).toEqual([
			{ file, path: "group/nested/file.bin" },
		]);
	});

	it("keeps plain file names when directory metadata is unavailable", () => {
		const file = new File(["release"], "file.bin");

		expect(createFolderSelections([file])).toEqual([
			{ file, path: "file.bin" },
		]);
	});

	it("accepts 10,001 files without a product-level total cap", () => {
		const files = Array.from({ length: 10_001 }, (_, index) =>
			folderFile(`release/${index}.bin`),
		);

		expect(createFolderSelections(files)).toHaveLength(files.length);
	});

	it("rejects normalized collisions, unsafe paths, and size overflow", () => {
		for (const files of [
			[folderFile("release/e\u0301.bin"), folderFile("release/é.bin")],
			[folderFile("release/../escape.bin")],
		]) {
			expect(() => createFolderSelections(files)).toThrowError(
				expect.objectContaining<Partial<FolderSelectionError>>({
					code: "INVALID_PATH",
				}),
			);
		}

		const tooLarge = folderFile("release/large.bin");
		Object.defineProperty(tooLarge, "size", {
			configurable: true,
			value: Number(MAX_UPLOAD_SIZE_BYTES + 1n),
		});
		expect(() => createFolderSelections([tooLarge])).toThrowError(
			expect.objectContaining({ code: "FILE_TOO_LARGE" }),
		);
	});
});
