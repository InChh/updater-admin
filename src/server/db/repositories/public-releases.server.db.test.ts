import { randomUUID } from "node:crypto";
import process from "node:process";

import { eq, inArray, or } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import {
	createDatabaseClient,
	type ManagedDatabaseClient,
} from "../client.server";
import {
	applications,
	applicationVersions,
	fileMetadata,
	versionFiles,
} from "../schema";
import { assertDisposableDatabaseGuard } from "../schema/database-test-safety";
import { createPublicReleasesRepository } from "./public-releases.server";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;

if (!testDatabaseUrl) {
	describe("public releases repository database integration", () => {
		it.skip("TEST_DATABASE_URL is absent; no disposable database was provisioned", () => {});
	});
} else {
	assertDisposableDatabaseGuard({
		confirmation: process.env.TEST_DATABASE_CONFIRM_DISPOSABLE,
		databaseUrl: process.env.DATABASE_URL,
		testDatabaseUrl,
	});

	describe("public releases repository database integration", () => {
		let client: ManagedDatabaseClient;
		const actorId = randomUUID();

		beforeAll(() => {
			client = createDatabaseClient({ databaseUrl: testDatabaseUrl });
		});

		afterEach(async () => {
			const testVersionIds = client.db
				.select({ id: applicationVersions.id })
				.from(applicationVersions)
				.where(
					or(
						eq(applicationVersions.createdBy, actorId),
						eq(applicationVersions.updatedBy, actorId),
					),
				);
			const testFileIds = client.db
				.select({ id: fileMetadata.id })
				.from(fileMetadata)
				.where(
					or(
						eq(fileMetadata.createdBy, actorId),
						eq(fileMetadata.updatedBy, actorId),
					),
				);
			await client.db
				.delete(versionFiles)
				.where(
					or(
						inArray(versionFiles.versionId, testVersionIds),
						inArray(versionFiles.fileMetadataId, testFileIds),
					),
				);
			await client.db
				.delete(applicationVersions)
				.where(
					or(
						eq(applicationVersions.createdBy, actorId),
						eq(applicationVersions.updatedBy, actorId),
					),
				);
			await client.db
				.delete(fileMetadata)
				.where(
					or(
						eq(fileMetadata.createdBy, actorId),
						eq(fileMetadata.updatedBy, actorId),
					),
				);
			await client.db
				.delete(applications)
				.where(
					or(
						eq(applications.createdBy, actorId),
						eq(applications.updatedBy, actorId),
					),
				);
		});

		afterAll(async () => {
			await client?.close();
		});

		async function insertProgram() {
			const [program] = await client.db
				.insert(applications)
				.values({
					createdBy: actorId,
					name: `Public releases ${randomUUID()}`,
					updatedBy: actorId,
				})
				.returning();
			if (!program) throw new Error("program insert returned no row");
			return program;
		}

		async function insertVersion(
			programId: string,
			input: {
				readonly isActive: boolean;
				readonly lifecycleStatus: "draft" | "finalized";
				readonly major: number;
			},
		) {
			const finalizedAt =
				input.lifecycleStatus === "finalized"
					? new Date(`2026-08-0${input.major}T01:00:00.000Z`)
					: null;
			const [version] = await client.db
				.insert(applicationVersions)
				.values({
					applicationId: programId,
					createdBy: actorId,
					description: `Version ${input.major}`,
					expectedFileCount: input.lifecycleStatus === "draft" ? 5 : null,
					finalizedAt,
					isActive: input.isActive,
					lifecycleStatus: input.lifecycleStatus,
					updatedBy: actorId,
					versionMajor: input.major,
					versionMinor: 0,
					versionNumber: `${input.major}.0.0`,
					versionPatch: 0,
				})
				.returning();
			if (!version) throw new Error("version insert returned no row");
			return version;
		}

		async function insertFile(path: string, index: number) {
			const sha256 = index.toString(16).padStart(64, "0");
			const [file] = await client.db
				.insert(fileMetadata)
				.values({
					createdBy: actorId,
					mimeType: "application/octet-stream",
					objectKey: `public-release-db-test/${randomUUID()}/${path}`,
					path,
					sha256,
					size: BigInt(index),
					updatedBy: actorId,
				})
				.returning();
			if (!file) throw new Error("file insert returned no row");
			return file;
		}

		it("excludes draft and inactive rows from latest and explicit headers", async () => {
			const program = await insertProgram();
			const published = await insertVersion(program.id, {
				isActive: true,
				lifecycleStatus: "finalized",
				major: 1,
			});
			await insertVersion(program.id, {
				isActive: false,
				lifecycleStatus: "finalized",
				major: 2,
			});
			await insertVersion(program.id, {
				isActive: false,
				lifecycleStatus: "draft",
				major: 3,
			});
			const repository = createPublicReleasesRepository(client.db);

			await expect(
				repository.findLatestHeader(program.id),
			).resolves.toMatchObject({
				fileCount: 0,
				versionNumber: published.versionNumber,
			});
			await expect(
				repository.findHeaderByVersionNumber(program.id, {
					versionMajor: 3,
					versionMinor: 0,
					versionNumber: "3.0.0",
					versionPatch: 0,
				}),
			).resolves.toBeNull();
		});

		it("traverses immutable path pages and selects only exact signing identities", async () => {
			const program = await insertProgram();
			const version = await insertVersion(program.id, {
				isActive: true,
				lifecycleStatus: "finalized",
				major: 4,
			});
			const files = await Promise.all([
				insertFile("e.bin", 5),
				insertFile("a.bin", 1),
				insertFile("d.bin", 4),
				insertFile("b.bin", 2),
				insertFile("c.bin", 3),
			]);
			await client.db.insert(versionFiles).values(
				files.map((file) => ({
					fileMetadataId: file.id,
					versionId: version.id,
				})),
			);
			const repository = createPublicReleasesRepository(client.db);
			const versionNumber = {
				versionMajor: 4,
				versionMinor: 0,
				versionNumber: "4.0.0",
				versionPatch: 0,
			} as const;

			const first = await repository.findFilePage({
				pageSize: 2,
				programId: program.id,
				version: versionNumber,
			});
			if (first.status !== "found" || first.page.nextPath === null) {
				throw new Error("first public release page was not found");
			}
			const second = await repository.findFilePage({
				afterPath: first.page.nextPath,
				pageSize: 2,
				programId: program.id,
				version: versionNumber,
			});
			if (second.status !== "found" || second.page.nextPath === null) {
				throw new Error("second public release page was not found");
			}
			const third = await repository.findFilePage({
				afterPath: second.page.nextPath,
				pageSize: 2,
				programId: program.id,
				version: versionNumber,
			});
			if (third.status !== "found") {
				throw new Error("third public release page was not found");
			}

			expect(
				[...first.page.items, ...second.page.items, ...third.page.items].map(
					({ path }) => path,
				),
			).toEqual(["a.bin", "b.bin", "c.bin", "d.bin", "e.bin"]);
			expect(first.page.nextPath).toBe("b.bin");
			expect(second.page.nextPath).toBe("d.bin");
			expect(third.page.nextPath).toBeNull();
			await expect(
				repository.findFilePage({
					afterPath: "tampered.bin",
					pageSize: 2,
					programId: program.id,
					version: versionNumber,
				}),
			).resolves.toEqual({ status: "cursorNotFound" });

			const selected = await repository.findDownloadFiles({
				files: [
					{ path: "a.bin", sha256: "1".padStart(64, "0") },
					{ path: "e.bin", sha256: "5".padStart(64, "0") },
				],
				programId: program.id,
				version: versionNumber,
			});
			expect(selected.map(({ path }) => path).sort()).toEqual([
				"a.bin",
				"e.bin",
			]);
			await expect(
				repository.findDownloadFiles({
					files: [{ path: "a.bin", sha256: "f".repeat(64) }],
					programId: program.id,
					version: versionNumber,
				}),
			).resolves.toEqual([]);
		});
	});
}
