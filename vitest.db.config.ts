import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		environment: "node",
		globalSetup: ["./src/test/db-global-setup.ts"],
		include: ["**/*.db.test.ts"],
		fileParallelism: false,
		// Remote Neon round trips can exceed Vitest's local-oriented defaults.
		hookTimeout: 30_000,
		maxWorkers: 1,
		sequence: {
			concurrent: false,
		},
		testTimeout: 30_000,
	},
});
