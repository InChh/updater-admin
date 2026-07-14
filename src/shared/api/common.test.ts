import { describe, expect, it } from "vitest";

import {
	formatWeakEntityTag,
	isWellFormedUnicode,
	parseWeakEntityTag,
	ROW_VERSION_MAX,
} from "./common";

describe("shared API common contracts", () => {
	it("formats positive row versions as opaque weak entity tags", () => {
		expect(formatWeakEntityTag(1n)).toBe('W/"1"');
		expect(formatWeakEntityTag(9_223_372_036_854_775_807n)).toBe(
			'W/"9223372036854775807"',
		);
	});

	it("rejects non-positive row versions", () => {
		expect(() => formatWeakEntityTag(0n)).toThrow(RangeError);
		expect(() => formatWeakEntityTag(-1n)).toThrow(RangeError);
		expect(() => formatWeakEntityTag(ROW_VERSION_MAX + 1n)).toThrow(RangeError);
	});

	it("parses only positive PostgreSQL int8 weak entity tags", () => {
		expect(parseWeakEntityTag('W/"1"')).toBe(1n);
		expect(parseWeakEntityTag('W/"9223372036854775807"')).toBe(ROW_VERSION_MAX);
		for (const invalid of [
			'W/"0"',
			'W/"01"',
			'W/"9223372036854775808"',
			'W/"999999999999999999999999999"',
			'"1"',
		]) {
			expect(parseWeakEntityTag(invalid)).toBeNull();
		}
	});

	it("distinguishes well-formed Unicode from unpaired surrogates", () => {
		expect(isWellFormedUnicode("plain 😀 text")).toBe(true);
		expect(isWellFormedUnicode("\ud800")).toBe(false);
		expect(isWellFormedUnicode("\udc00")).toBe(false);
		expect(isWellFormedUnicode("\ud800x")).toBe(false);
	});
});
