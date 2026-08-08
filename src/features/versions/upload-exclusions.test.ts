import { describe, expect, it } from "vitest";

import {
	createUploadExclusionConfig,
	DEFAULT_UPLOAD_EXCLUSION_ENTRIES,
	DEFAULT_UPLOAD_EXCLUSIONS,
	parseUploadExclusions,
	uploadPathMatchesExclusion,
} from "./upload-exclusions";

describe("upload exclusion rules", () => {
	it("ships the requested default files and directories", () => {
		expect(DEFAULT_UPLOAD_EXCLUSION_ENTRIES).toEqual([
			"lib/acad.dat",
			"lib/sysdir.txt",
			"lib/tm.shx",
			"UpdaterTemp/",
			"logs/",
			"workdir",
		]);
		expect(DEFAULT_UPLOAD_EXCLUSIONS).toBe(
			DEFAULT_UPLOAD_EXCLUSION_ENTRIES.join("\n"),
		);
	});

	it("matches GitIgnore wildcards, comments, directories, and negation", () => {
		const matcher = parseUploadExclusions(`
# generated files
**/*.tmp
*.log
!important.log
cache-?/output.bin
`);

		expect(uploadPathMatchesExclusion("nested/generated.tmp", matcher)).toBe(
			true,
		);
		expect(uploadPathMatchesExclusion("nested/debug.log", matcher)).toBe(true);
		expect(uploadPathMatchesExclusion("important.log", matcher)).toBe(false);
		expect(uploadPathMatchesExclusion("cache-a/output.bin", matcher)).toBe(
			true,
		);
		expect(uploadPathMatchesExclusion("cache-aa/output.bin", matcher)).toBe(
			false,
		);
	});

	it("applies default root paths and directory names case-insensitively", () => {
		const matcher = parseUploadExclusions(DEFAULT_UPLOAD_EXCLUSIONS);

		expect(uploadPathMatchesExclusion("lib/acad.dat", matcher)).toBe(true);
		expect(uploadPathMatchesExclusion("nested/lib/acad.dat", matcher)).toBe(
			false,
		);
		expect(uploadPathMatchesExclusion("nested/LOGS/debug.log", matcher)).toBe(
			true,
		);
		expect(uploadPathMatchesExclusion("workdir/cache/item.bin", matcher)).toBe(
			true,
		);
		expect(uploadPathMatchesExclusion("workdirectory/item.bin", matcher)).toBe(
			false,
		);
	});

	it("keeps edited rules in the in-memory upload session", () => {
		const config = createUploadExclusionConfig();
		expect(config.getValue()).toBe(DEFAULT_UPLOAD_EXCLUSIONS);

		config.setValue("dist/**\n*.map");
		expect(config.getValue()).toBe("dist/**\n*.map");
	});
});
