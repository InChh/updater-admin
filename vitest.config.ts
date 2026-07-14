import { configDefaults, defineConfig } from "vitest/config";
import solidPlugin from "vite-plugin-solid";

export default defineConfig({
	plugins: [solidPlugin()],
	test: {
		environment: "jsdom",
		setupFiles: ["./src/test/setup.ts"],
		exclude: [
			...configDefaults.exclude,
			"**/*.db.test.ts",
			"tests/e2e/**",
		],
	},
});
