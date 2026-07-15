import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

interface PackageManifest {
	readonly dependencies?: Readonly<Record<string, string>>;
}

function readPackageManifest(): PackageManifest {
	return JSON.parse(
		readFileSync(resolve(process.cwd(), "package.json"), "utf8"),
	) as PackageManifest;
}

describe("deployment runtime dependencies", () => {
	it("owns the Zod 4 runtime required by the externalized Better Auth schema", () => {
		const version = readPackageManifest().dependencies?.zod;

		expect(version).toMatch(/^\^4\./);
	});
});
