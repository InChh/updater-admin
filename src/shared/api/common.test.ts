import { describe, expect, it } from "vitest";

import { formatWeakEntityTag } from "./common";

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
	});
});
