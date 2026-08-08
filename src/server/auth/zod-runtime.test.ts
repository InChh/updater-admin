import { describe, expect, it } from "vitest";
import * as z from "zod";

describe("Better Auth runtime schema dependency", () => {
	it("resolves the Zod 4 metadata API from the application dependency graph", () => {
		expect(z.coerce.boolean().meta).toBeTypeOf("function");
	});
});
