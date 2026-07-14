import { describe, expect, it } from "vitest";

import {
	MAX_UPLOAD_FILES,
	MAX_UPLOAD_SIZE_BYTES,
} from "../../shared/api/uploads";
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
	it("preserves File identity while normalizing and sorting relative paths", () => {
		const second = folderFile("release/z.bin");
		const first = folderFile("release/cafe\u0301.bin");

		expect(createFolderSelections([second, first])).toEqual([
			{ file: first, path: "release/café.bin" },
			{ file: second, path: "release/z.bin" },
		]);
	});

	it("rejects normalized collisions, unsafe paths, count overflow, and size overflow", () => {
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

		const tooMany = Array.from({ length: MAX_UPLOAD_FILES + 1 }, (_, index) =>
			folderFile(`release/${index}.bin`),
		);
		expect(() => createFolderSelections(tooMany)).toThrowError(
			expect.objectContaining({ code: "TOO_MANY_FILES" }),
		);

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
