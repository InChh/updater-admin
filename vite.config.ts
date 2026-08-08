import process from "node:process";

import netlify from "@netlify/vite-plugin-tanstack-start";
import { sentryVitePlugin } from "@sentry/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import { devtools } from "@tanstack/devtools-vite";

import { tanstackStart } from "@tanstack/solid-start/plugin/vite";
import { defineConfig, type PluginOption } from "vite";
import solidPlugin from "vite-plugin-solid";

import { resolveBrowserSentryEnvironment } from "./src/build/sentry-environment";

function trimmedEnvironment(name: string): string | undefined {
	return process.env[name]?.trim() || undefined;
}

export default defineConfig(({ mode }) => {
	const authToken = trimmedEnvironment("SENTRY_AUTH_TOKEN");
	const organization = trimmedEnvironment("SENTRY_ORG");
	const project = trimmedEnvironment("SENTRY_PROJECT");
	const release =
		trimmedEnvironment("COMMIT_REF") ?? trimmedEnvironment("SENTRY_RELEASE");
	const sentryEnvironment = resolveBrowserSentryEnvironment(mode, process.env);
	const canUploadSourceMaps = Boolean(authToken && organization && project);
	const plugins: PluginOption[] = [
		devtools(),
		tailwindcss(),
		tanstackStart(),
		solidPlugin({ ssr: true }),
		// Netlify's package-shipped guidance requires the framework transforms
		// first; the optional Sentry uploader remains last below.
		netlify(),
	];

	if (canUploadSourceMaps) {
		plugins.push(
			...sentryVitePlugin({
				authToken,
				org: organization,
				project,
				release: {
					...(release ? { name: release } : {}),
					setCommits: false,
				},
				sourcemaps: {
					assets: ["dist/client/**/*.{js,map}", "dist/server/**/*.{js,map}"],
				},
				telemetry: false,
			}),
		);
	}

	return {
		build: { sourcemap: canUploadSourceMaps ? ("hidden" as const) : false },
		define: {
			__SENTRY_ENVIRONMENT__: JSON.stringify(sentryEnvironment),
			__SENTRY_RELEASE__: JSON.stringify(release ?? ""),
		},
		plugins,
		resolve: { tsconfigPaths: true },
		// Netlify V2 Functions are packaged with NFT. Keep Better Auth's
		// instrumentation constants inside the SSR bundle so the deployed
		// function never depends on a pnpm symlink surviving packaging.
		ssr: { noExternal: ["@opentelemetry/semantic-conventions"] },
	};
});
