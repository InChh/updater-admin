import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import process from "node:process";

import { config as loadEnvironment } from "dotenv";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import type { PublicReleaseManifestDto } from "../src/shared/api/public-releases";
import { createApiApp } from "../src/server/api/app.server";
import type { Database } from "../src/server/db/client.server";
import { createPublicReleasesRepository } from "../src/server/db/repositories/public-releases.server";
import * as schema from "../src/server/db/schema";
import { createPublicReleasesService } from "../src/server/domain/public-releases.server";

loadEnvironment({ path: [".env.local", ".env"], quiet: true });

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required.");

const acceptanceOutput =
	process.env.LARGE_ACCEPTANCE_OUTPUT ??
	"/private/tmp/updater-admin-large-acceptance.json";

interface AcceptanceOutput {
	readonly activeVersion: string;
	readonly expected: readonly {
		readonly path: string;
		readonly sha256: string;
		readonly size: string;
	}[];
	readonly modifiedPath: string;
	readonly programId: string;
	readonly rootName: string;
}

function validateManifest(
	manifest: PublicReleaseManifestDto,
	acceptance: AcceptanceOutput,
): void {
	if (manifest.programId !== acceptance.programId) {
		throw new Error(`Unexpected program id: ${manifest.programId}.`);
	}
	if (manifest.versionNumber !== acceptance.activeVersion) {
		throw new Error(`Unexpected latest version: ${manifest.versionNumber}.`);
	}
	if (manifest.files.length !== acceptance.expected.length) {
		throw new Error(
			`Expected ${acceptance.expected.length} files, got ${manifest.files.length}.`,
		);
	}
	const expectedByPath = new Map(
		acceptance.expected.map((file) => [file.path, file] as const),
	);
	const observedPaths = new Set<string>();
	for (const file of manifest.files) {
		if (observedPaths.has(file.path)) {
			throw new Error(`Duplicate manifest path: ${file.path}.`);
		}
		observedPaths.add(file.path);
		const segments = file.path.split("/");
		if (
			file.path.startsWith("/") ||
			file.path.includes("\\") ||
			segments.some((segment) => !segment || segment === "." || segment === "..") ||
			segments[0] === acceptance.rootName
		) {
			throw new Error(`Manifest path is not relative to the selected root: ${file.path}.`);
		}
		const expected = expectedByPath.get(file.path);
		if (
			!expected ||
			file.sha256 !== expected.sha256 ||
			file.size !== expected.size
		) {
			throw new Error(`Manifest metadata mismatch: ${file.path}.`);
		}
		const downloadUrl = new URL(file.downloadUrl);
		if (downloadUrl.protocol !== "https:" || downloadUrl.username || downloadUrl.password) {
			throw new Error(`Manifest download URL is invalid: ${file.path}.`);
		}
	}
	if (!observedPaths.has(acceptance.modifiedPath)) {
		throw new Error("Modified file is missing from the latest manifest.");
	}
}

async function main() {
	const acceptance = JSON.parse(
		await readFile(acceptanceOutput, "utf8"),
	) as AcceptanceOutput;
	const pool = new Pool({ connectionString: databaseUrl, max: 4 });
	const database = drizzle(pool, { schema }) as unknown as Database;
	const repository = createPublicReleasesRepository(database);
	const service = createPublicReleasesService({
		repository,
		v2Repository: repository,
	});
	const app = createApiApp({
		appendFailureAudit: async () => undefined,
		consumeRateLimit: async (input) => ({
			allowed: true,
			count: 1,
			limit: input.limit,
			remaining: input.limit - 1,
			resetAt: new Date(input.now.getTime() + input.windowSeconds * 1_000),
			retryAfterSeconds: input.windowSeconds,
		}),
		generateRequestId: () => "req_large_client_acceptance",
		getCanonicalOrigin: () => "http://127.0.0.1",
		getPublicApiAllowedOrigins: () => [],
		getPublicReleasesService: () => service,
		getPublicReleasesV2Service: () => service,
		getSession: async () => null,
		reportInternalError: (error) => console.error(error),
	});
	const server = createServer(async (incoming, outgoing) => {
		try {
			const host = incoming.headers.host ?? "127.0.0.1";
			const request = new Request(
				new URL(incoming.url ?? "/", `http://${host}`),
				{
					headers: new Headers(incoming.headers as HeadersInit),
					method: incoming.method ?? "GET",
				},
			);
			const response = await app.handle(request);
			outgoing.statusCode = response.status;
			response.headers.forEach((value, name) => outgoing.setHeader(name, value));
			outgoing.end(Buffer.from(await response.arrayBuffer()));
		} catch (error) {
			console.error(error);
			outgoing.statusCode = 500;
			outgoing.end("Internal Server Error");
		}
	});
	try {
		await new Promise<void>((resolve, reject) => {
			server.once("error", reject);
			server.listen(0, "127.0.0.1", resolve);
		});
		const address = server.address();
		if (!address || typeof address === "string") {
			throw new Error("Local public API server did not expose a TCP port.");
		}
		const startedAt = Date.now();
		const response = await fetch(
			`http://127.0.0.1:${address.port}/api/public/v1/programs/${acceptance.programId}/releases/latest`,
			{
				headers: { accept: "application/json" },
				signal: AbortSignal.timeout(30_000),
			},
		);
		if (!response.ok) {
			throw new Error(`Public API returned ${response.status}: ${await response.text()}`);
		}
		const manifest = (await response.json()) as PublicReleaseManifestDto;
		validateManifest(manifest, acceptance);
		process.stdout.write(
			`${JSON.stringify({
				fileCount: manifest.files.length,
				latestVersion: manifest.versionNumber,
				modifiedPath: acceptance.modifiedPath,
				requestDurationMs: Date.now() - startedAt,
				rootDirectoryExcluded: true,
				uniqueRelativePaths: new Set(manifest.files.map(({ path }) => path)).size,
			})}\n`,
		);
	} finally {
		await new Promise<void>((resolve, reject) =>
			server.close((error) => (error ? reject(error) : resolve())),
		);
		await pool.end();
	}
}

await main();
