import { describe, expect, it } from "vitest";

import {
	compareVersionNumbers,
	parseVersionNumber,
	VERSION_COMPONENT_MAX,
	VERSION_NUMBER_MAX_LENGTH,
} from "./version-number";

describe("semantic version number", () => {
	it("parses canonical unsigned numeric major.minor.patch", () => {
		expect(parseVersionNumber("1.10.0")).toEqual({
			major: 1,
			minor: 10,
			normalized: "1.10.0",
			patch: 0,
		});
		expect(parseVersionNumber("0.0.0")).toEqual({
			major: 0,
			minor: 0,
			normalized: "0.0.0",
			patch: 0,
		});
	});

	it("rejects non-canonical spellings and segment counts", () => {
		for (const invalid of [
			"",
			"1",
			"1.2",
			"1.2.3.4",
			"01.2.3",
			"1.02.3",
			"1.2.03",
			"+1.2.3",
			"-1.2.3",
			" 1.2.3",
			"1.2.3 ",
			"1.2.3-alpha",
			"1.2.3+build",
			"1.2.x",
			"1..3",
			"1.2.3\n",
			null,
			123,
		]) {
			expect(parseVersionNumber(invalid), String(invalid)).toBeNull();
		}
	});

	it("enforces PostgreSQL int4 component boundaries", () => {
		expect(VERSION_COMPONENT_MAX).toBe(2_147_483_647);
		expect(parseVersionNumber("2147483647.0.0")?.major).toBe(
			VERSION_COMPONENT_MAX,
		);
		expect(parseVersionNumber("0.2147483647.0")?.minor).toBe(
			VERSION_COMPONENT_MAX,
		);
		expect(parseVersionNumber("0.0.2147483647")?.patch).toBe(
			VERSION_COMPONENT_MAX,
		);
		expect(parseVersionNumber("2147483648.0.0")).toBeNull();
		expect(parseVersionNumber("0.2147483648.0")).toBeNull();
		expect(parseVersionNumber("0.0.2147483648")).toBeNull();
	});

	it("enforces the varchar(20) normalized display boundary", () => {
		const exactBoundary = "999999.999999.999999";
		expect(exactBoundary).toHaveLength(VERSION_NUMBER_MAX_LENGTH);
		expect(parseVersionNumber(exactBoundary)?.normalized).toBe(exactBoundary);

		const tooLong = "1000000.999999.999999";
		expect(tooLong).toHaveLength(VERSION_NUMBER_MAX_LENGTH + 1);
		expect(parseVersionNumber(tooLong)).toBeNull();
		expect(parseVersionNumber("2147483647.2147483647.0")).toBeNull();
	});

	it("orders numeric triplets rather than version display strings", () => {
		const newer = parseVersionNumber("1.10.0");
		const older = parseVersionNumber("1.9.99");
		expect(newer).not.toBeNull();
		expect(older).not.toBeNull();
		if (!newer || !older) throw new Error("test fixture did not parse");

		expect(compareVersionNumbers(newer, older)).toBe(1);
		expect(compareVersionNumbers(older, newer)).toBe(-1);
		expect(compareVersionNumbers(newer, { ...newer })).toBe(0);
		expect("1.10.0" > "1.9.99").toBe(false);
	});
});
