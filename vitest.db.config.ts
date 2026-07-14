import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		environment: "node",
		globalSetup: ["./src/test/db-global-setup.ts"],
		include: ["**/*.db.test.ts"],
		fileParallelism: false,
		maxWorkers: 1,
		sequence: {
			concurrent: false,
		},
	},
});
