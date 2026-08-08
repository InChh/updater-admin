import { randomUUID } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { basename, join, relative, sep } from "node:path";
import process from "node:process";

import { config as loadEnvironment } from "dotenv";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import AliOss from "ali-oss";

import { createUploadQueueController } from "../src/features/versions/upload-store";
import { createUploadWorkflow } from "../src/features/versions/upload-workflow.client";
import { hashFileIncrementally } from "../src/features/versions/hash-worker";
import {
	type AliOssClientConfiguration,
	type AliOssClientLike,
	type AliOssMultipartOptions,
	type AliOssMultipartResult,
	type AliOssPutOptions,
	startOssMultipartUpload,
} from "../src/features/versions/oss-uploader.client";
import type { Database } from "../src/server/db/client.server";
import { createAuditRepository } from "../src/server/db/repositories/audit.server";
import { createDraftVersionFilesService } from "../src/server/domain/draft-version-files.server";
import { createUploadsService } from "../src/server/domain/uploads.server";
import { createDraftVersionFilesRepository } from "../src/server/db/repositories/draft-version-files.server";
import { createVersionsRepository } from "../src/server/db/repositories/versions.server";
import * as schema from "../src/server/db/schema";

loadEnvironment({ path: [".env.local", ".env"], quiet: true });

const FILE_COUNT = 2_000;
const OUTPUT_PATH =
	process.env.LARGE_ACCEPTANCE_OUTPUT ??
	"/private/tmp/updater-admin-large-acceptance.json";
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required.");

const runId = new Date().toISOString().replaceAll(/[^0-9]/g, "").slice(0, 14);
const fixtureRoot = `/private/tmp/updater-selected-root-${runId}`;
const actorId = randomUUID();
const audit = (suffix: string) => ({
	actorId,
	ip: "127.0.0.1",
	requestId: `large_acceptance_${runId}_${suffix}`,
	userAgent: "updater-admin-large-acceptance",
});

function relativeUploadPath(root: string, filePath: string): string {
	return relative(root, filePath).split(sep).join("/");
}

function createNodeOssClient(
	configuration: AliOssClientConfiguration,
): AliOssClientLike {
	type NodeAliOssClient = {
		abortMultipartUpload(
			objectKey: string,
			uploadId: string,
			options?: Readonly<{ timeout: number }>,
		): Promise<unknown>;
		cancel(): void;
		isCancel(): boolean;
		multipartUpload(
			objectKey: string,
			file: Buffer,
			options: AliOssMultipartOptions,
		): Promise<AliOssMultipartResult>;
		put(
			objectKey: string,
			file: Buffer,
			options: AliOssPutOptions,
		): Promise<AliOssMultipartResult>;
	};
	const NodeAliOss = AliOss as unknown as new (
		input: AliOssClientConfiguration,
	) => NodeAliOssClient;
	const client = new NodeAliOss(configuration);
	return {
		abortMultipartUpload: (objectKey, uploadId, options) =>
			client.abortMultipartUpload(objectKey, uploadId, options),
		cancel: () => client.cancel(),
		isCancel: () => client.isCancel(),
		multipartUpload: async (objectKey, file, options) =>
			client.multipartUpload(
				objectKey,
				Buffer.from(await file.arrayBuffer()),
				options,
			),
		put: async (objectKey, file, options) =>
			client.put(objectKey, Buffer.from(await file.arrayBuffer()), options),
	};
}

async function materializeFiles(): Promise<readonly string[]> {
	await rm(fixtureRoot, { force: true, recursive: true });
	const paths: string[] = [];
	for (let index = 0; index < FILE_COUNT; index += 1) {
		const path = join(
			fixtureRoot,
			`group-${String(index % 20).padStart(2, "0")}`,
			`nested-${String(Math.floor(index / 20) % 10).padStart(2, "0")}`,
			`file-${String(index).padStart(4, "0")}.bin`,
		);
		await mkdir(join(path, ".."), { recursive: true });
		await writeFile(path, `updater-admin:${runId}:${index}:v1\n`);
		paths.push(path);
	}
	return paths;
}

async function selections(filePaths: readonly string[]) {
	return Promise.all(
		filePaths.map(async (path) => {
			const bytes = await readFile(path);
			return {
				file: new File([bytes], basename(path), {
					type: "application/octet-stream",
				}),
				path: relativeUploadPath(fixtureRoot, path),
			};
		}),
	);
}

export async function runLargeReleaseAcceptance() {
	const pool = new Pool({ connectionString: databaseUrl, max: 4 });
	const database = drizzle(pool, { schema }) as unknown as Database;
	try {
		const [program] = await database
			.insert(schema.applications)
			.values({
				createdBy: actorId,
				description: "Local 2,000-file acceptance fixture",
				name: `Large acceptance ${runId}`,
				updatedBy: actorId,
			})
			.returning();
		if (!program) throw new Error("Program insert returned no row.");

		const versions = createVersionsRepository(database);
		const draftFiles = createDraftVersionFilesService({
			repository: createDraftVersionFilesRepository(database),
		});
		const uploads = createUploadsService({
			auditRepository: createAuditRepository(database),
		});
		const physicalPaths = await materializeFiles();
		process.stdout.write(`fixture-ready files=${physicalPaths.length}\n`);

		const runVersion = async (
			major: number,
			selectedPaths: readonly string[] = physicalPaths,
		) => {
			const draft = await versions.createDraft({
				audit: audit(`create_${major}`),
				description: `Large acceptance version ${major}.0.0`,
				expectedFileCount: selectedPaths.length,
				programId: program.id,
				versionMajor: major,
				versionMinor: 0,
				versionNumber: `${major}.0.0`,
				versionPatch: 0,
			});
			const queue = createUploadQueueController({ storage: null });
			queue.addFiles(await selections(selectedPaths));
			const workflow = createUploadWorkflow(queue, {
				completeUploads: (input) =>
					draftFiles.complete(
						program.id,
						draft.id,
						input,
						audit(`complete_${major}_${randomUUID()}`),
					),
				requestCredentials: (input) =>
					uploads.issueCredentials(input, audit(`credentials_${major}`)),
				resolveFiles: (input) =>
					draftFiles.resolve(
						program.id,
						draft.id,
						input,
						audit(`resolve_${major}_${randomUUID()}`),
					),
				startHashTask: ({ file, itemId, onProgress }) => {
					let cancelled = false;
					return {
						cancel: () => {
							cancelled = true;
						},
						jobId: itemId,
						promise: hashFileIncrementally(file, {
							isCancelled: () => cancelled,
							onProgress,
						}),
					};
				},
				startUploadTask: (input) =>
					startOssMultipartUpload(input, {
						createClient: createNodeOssClient,
					}),
			});
			workflow.setDraft({ programId: program.id, versionId: draft.id });
			const startedAt = Date.now();
			const progress = setInterval(() => {
				const items = queue.getState().items;
				process.stdout.write(
					`version-${major} hashed=${items.filter(({ sha256 }) => sha256).length} complete=${items.filter(({ status }) => status === "complete").length} failed=${items.filter(({ status }) => status === "failed").length}\n`,
				);
			}, 10_000);
			try {
				await workflow.start();
			} finally {
				clearInterval(progress);
			}
			const items = queue.getState().items;
			const counts = {
				complete: items.filter(({ status }) => status === "complete").length,
				reused: items.filter(
					({ resolutionStatus }) => resolutionStatus === "reused",
				).length,
				uploadRequired: items.filter(
					({ resolutionStatus }) => resolutionStatus === "uploadRequired",
				).length,
			};
			if (counts.complete !== selectedPaths.length) {
				throw new Error(`Version ${major} completed ${counts.complete} files.`);
			}
			workflow.dispose();
			queue.dispose();
			const finalized = await versions.finalize({
				audit: audit(`finalize_${major}`),
				expectedRowVersion: draft.rowVersion,
				id: draft.id,
				now: new Date(),
				programId: program.id,
			});
			return {
				counts,
				durationMs: Date.now() - startedAt,
				version: finalized,
			};
		};

		const first = await runVersion(1);
		process.stdout.write(
			`version-1-finished durationMs=${first.durationMs} uploaded=${first.counts.uploadRequired}\n`,
		);
		const modifiedIndex = 1_337;
		await writeFile(
			physicalPaths[modifiedIndex]!,
			`updater-admin:${runId}:${modifiedIndex}:v2-modified\n`,
		);
		const second = await runVersion(2);
		process.stdout.write(
			`version-2-finished durationMs=${second.durationMs} reused=${second.counts.reused} uploaded=${second.counts.uploadRequired}\n`,
		);
		if (second.counts.reused !== FILE_COUNT - 1) {
			throw new Error(`Expected 1,999 reused files, got ${second.counts.reused}.`);
		}
		if (second.counts.uploadRequired !== 1) {
			throw new Error(
				`Expected one changed upload, got ${second.counts.uploadRequired}.`,
			);
		}
		const deletedPhysicalPaths = physicalPaths.slice(0, 60);
		await Promise.all(deletedPhysicalPaths.map((path) => rm(path)));
		const retainedPhysicalPaths = physicalPaths.slice(60);
		const modifiedPhysicalPaths = retainedPhysicalPaths.slice(100, 105);
		await Promise.all(
			modifiedPhysicalPaths.map((path, index) =>
				writeFile(path, `updater-admin:${runId}:mixed-modified:${index}\n`),
			),
		);
		const addedPhysicalPaths = await Promise.all(
			Array.from({ length: 10 }, async (_, index) => {
				const path = join(
					fixtureRoot,
					"added",
					`set-${String(index % 3).padStart(2, "0")}`,
					`new-${String(index).padStart(4, "0")}.bin`,
				);
				await mkdir(join(path, ".."), { recursive: true });
				await writeFile(path, `updater-admin:${runId}:added:${index}\n`);
				return path;
			}),
		);
		const mixedPhysicalPaths = [
			...retainedPhysicalPaths,
			...addedPhysicalPaths,
		];
		if (mixedPhysicalPaths.length !== 1_950) {
			throw new Error(
				`Expected 1,950 mixed-change files, got ${mixedPhysicalPaths.length}.`,
			);
		}
		const mixed = await runVersion(3, mixedPhysicalPaths);
		process.stdout.write(
			`version-3-finished durationMs=${mixed.durationMs} reused=${mixed.counts.reused} uploaded=${mixed.counts.uploadRequired}\n`,
		);
		if (mixed.counts.reused !== 1_935) {
			throw new Error(
				`Expected 1,935 reused mixed-change files, got ${mixed.counts.reused}.`,
			);
		}
		if (mixed.counts.uploadRequired !== 15) {
			throw new Error(
				`Expected 15 mixed-change uploads, got ${mixed.counts.uploadRequired}.`,
			);
		}
		const active = await versions.setActivation({
			audit: audit("activate_3"),
			expectedRowVersion: mixed.version.rowVersion,
			id: mixed.version.id,
			isActive: true,
			now: new Date(),
			programId: program.id,
		});

		const expected = await Promise.all(
			(await selections(mixedPhysicalPaths)).map(async ({ file, path }) => ({
				path,
				sha256: await hashFileIncrementally(file),
				size: String(file.size),
			})),
		);
		const output = {
			activeVersion: active.versionNumber,
			expected,
			fileCount: mixedPhysicalPaths.length,
			first: { counts: first.counts, durationMs: first.durationMs },
			fixtureRoot,
			modifiedPath: expected[modifiedIndex]?.path,
			mixed: {
				addedPaths: addedPhysicalPaths.map((path) =>
					relativeUploadPath(fixtureRoot, path),
				),
				counts: mixed.counts,
				deletedPaths: deletedPhysicalPaths.map((path) =>
					relativeUploadPath(fixtureRoot, path),
				),
				durationMs: mixed.durationMs,
				modifiedPaths: modifiedPhysicalPaths.map((path) =>
					relativeUploadPath(fixtureRoot, path),
				),
			},
			programId: program.id,
			rootName: basename(fixtureRoot),
			runId,
			second: { counts: second.counts, durationMs: second.durationMs },
		};
		await writeFile(OUTPUT_PATH, `${JSON.stringify(output, null, 2)}\n`);
		process.stdout.write(`${JSON.stringify({ ...output, expected: undefined })}\n`);
	} finally {
		await pool.end();
	}
}
