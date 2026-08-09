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
	auditEvents,
	fileMetadata,
	versionFiles,
} from "../schema";
import { assertDisposableDatabaseGuard } from "../schema/database-test-safety";
import {
	createVersionsRepository,
	DraftIncompleteRepositoryError,
	VersionFinalizedRequiredRepositoryError,
	VersionNumberConflictRepositoryError,
} from "./versions.server";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;

if (!testDatabaseUrl) {
	describe("versions repository database integration", () => {
		it.skip("TEST_DATABASE_URL is absent; no disposable database was provisioned", () => {});
	});
} else {
	assertDisposableDatabaseGuard({
		confirmation: process.env.TEST_DATABASE_CONFIRM_DISPOSABLE,
		databaseUrl: process.env.DATABASE_URL,
		testDatabaseUrl,
	});

	describe("versions repository database integration", () => {
		let client: ManagedDatabaseClient;
		const actorId = randomUUID();
		const audit = (requestId = `req_${randomUUID()}`) => ({
			actorId,
			ip: "203.0.113.8",
			requestId,
			userAgent: "versions-db-test",
		});

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
				.delete(auditEvents)
				.where(eq(auditEvents.actorId, actorId));
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

		async function insertProgram(name: string) {
			const [program] = await client.db
				.insert(applications)
				.values({ createdBy: actorId, name, updatedBy: actorId })
				.returning();
			if (!program) throw new Error("program insert returned no row");
			return program;
		}

		async function insertFile(path: string) {
			const sha256 = randomUUID().replaceAll("-", "").repeat(2);
			const [file] = await client.db
				.insert(fileMetadata)
				.values({
					createdBy: actorId,
					mimeType: "application/octet-stream",
					objectKey: `versions-db-test/${sha256}/${path}`,
					path,
					sha256,
					size: 42n,
					updatedBy: actorId,
				})
				.returning();
			if (!file) throw new Error("file insert returned no row");
			return file;
		}

		it("serializes concurrent draft creation for one semantic version", async () => {
			const program = await insertProgram(`Concurrent ${randomUUID()}`);
			const repository = createVersionsRepository(client.db);
			const candidate = {
				description: "Concurrent candidate",
				expectedFileCount: 1,
				programId: program.id,
				versionMajor: 1,
				versionMinor: 0,
				versionNumber: "1.0.0",
				versionPatch: 0,
			} as const;
			const results = await Promise.allSettled([
				repository.createDraft({ ...candidate, audit: audit() }),
				repository.createDraft({ ...candidate, audit: audit() }),
			]);

			expect(
				results.filter(({ status }) => status === "fulfilled"),
			).toHaveLength(1);
			const rejected = results.find(
				(result): result is PromiseRejectedResult =>
					result.status === "rejected",
			);
			expect(rejected?.reason).toBeInstanceOf(
				VersionNumberConflictRepositoryError,
			);
		});

		it("allows deleted draft and finalized version numbers to be reused", async () => {
			const program = await insertProgram(`Version history ${randomUUID()}`);
			const repository = createVersionsRepository(client.db);
			const draft = await repository.createDraft({
				audit: audit(),
				description: "Discarded draft",
				expectedFileCount: 1,
				programId: program.id,
				versionMajor: 1,
				versionMinor: 0,
				versionNumber: "1.0.0",
				versionPatch: 0,
			});
			await repository.delete({
				audit: audit(),
				expectedRowVersion: draft.rowVersion,
				id: draft.id,
				now: new Date(),
				programId: program.id,
			});

			await expect(
				repository.createDraft({
					audit: audit(),
					description: "Recreated draft",
					expectedFileCount: 1,
					programId: program.id,
					versionMajor: 1,
					versionMinor: 0,
					versionNumber: "1.0.0",
					versionPatch: 0,
				}),
			).resolves.toMatchObject({ versionNumber: "1.0.0" });
			await expect(
				repository.createDraft({
					audit: audit(),
					description: "Another unfinalized version",
					expectedFileCount: 1,
					programId: program.id,
					versionMajor: 0,
					versionMinor: 9,
					versionNumber: "0.9.0",
					versionPatch: 0,
				}),
			).resolves.toMatchObject({ versionNumber: "0.9.0" });

			await client.db.insert(applicationVersions).values({
				applicationId: program.id,
				createdBy: actorId,
				deletedAt: new Date(),
				deletedBy: actorId,
				description: "Deleted finalized release",
				expectedFileCount: null,
				finalizedAt: new Date(),
				isActive: false,
				lifecycleStatus: "finalized",
				updatedBy: actorId,
				versionMajor: 2,
				versionMinor: 0,
				versionNumber: "2.0.0",
				versionPatch: 0,
			});

			await expect(
				repository.createDraft({
					audit: audit(),
					description: "Recreated finalized version number",
					expectedFileCount: 1,
					programId: program.id,
					versionMajor: 2,
					versionMinor: 0,
					versionNumber: "2.0.0",
					versionPatch: 0,
				}),
			).resolves.toMatchObject({ versionNumber: "2.0.0" });
		});

		it("rejects incomplete finalization then atomically finalizes exact membership", async () => {
			const program = await insertProgram(`Finalize ${randomUUID()}`);
			const repository = createVersionsRepository(client.db);
			const draft = await repository.createDraft({
				audit: audit(),
				description: "Draft",
				expectedFileCount: 2,
				programId: program.id,
				versionMajor: 1,
				versionMinor: 0,
				versionNumber: "1.0.0",
				versionPatch: 0,
			});

			await expect(
				repository.finalize({
					audit: audit(),
					expectedRowVersion: draft.rowVersion,
					id: draft.id,
					now: new Date(),
					programId: program.id,
				}),
			).rejects.toBeInstanceOf(DraftIncompleteRepositoryError);

			const files = await Promise.all([
				insertFile(`a-${randomUUID()}.bin`),
				insertFile(`b-${randomUUID()}.bin`),
			]);
			await client.db.insert(versionFiles).values(
				files.map((file) => ({
					fileMetadataId: file.id,
					versionId: draft.id,
				})),
			);
			const finalized = await repository.finalize({
				audit: audit(),
				expectedRowVersion: draft.rowVersion,
				id: draft.id,
				now: new Date(),
				programId: program.id,
			});
			expect(finalized).toMatchObject({
				associatedFileCount: 2,
				lifecycleStatus: "finalized",
				rowVersion: draft.rowVersion + 1n,
			});
			expect(finalized.finalizedAt).toBeInstanceOf(Date);
		});

		it("forbids draft activation and keeps finalized latest lifecycle-aware", async () => {
			const program = await insertProgram(`Lifecycle ${randomUUID()}`);
			const repository = createVersionsRepository(client.db);
			const draft = await repository.createDraft({
				audit: audit(),
				description: "Draft",
				expectedFileCount: 1,
				programId: program.id,
				versionMajor: 1,
				versionMinor: 0,
				versionNumber: "1.0.0",
				versionPatch: 0,
			});
			await expect(
				repository.setActivation({
					audit: audit(),
					expectedRowVersion: draft.rowVersion,
					id: draft.id,
					isActive: true,
					now: new Date(),
					programId: program.id,
				}),
			).rejects.toBeInstanceOf(VersionFinalizedRequiredRepositoryError);

			const [migrated] = await client.db
				.insert(applicationVersions)
				.values({
					applicationId: program.id,
					createdBy: actorId,
					description: "Migrated",
					expectedFileCount: null,
					finalizedAt: new Date(),
					isActive: true,
					lifecycleStatus: "finalized",
					updatedBy: actorId,
					versionMajor: 2,
					versionMinor: 0,
					versionNumber: "2.0.0",
					versionPatch: 0,
				})
				.returning();
			if (!migrated) throw new Error("migrated insert returned no row");
			const listed = await repository.list({
				page: 1,
				pageSize: 20,
				programId: program.id,
				sort: "createdAt:desc",
			});
			expect(listed.items.find(({ id }) => id === migrated.id)).toMatchObject({
				expectedFileCount: null,
				isLatest: true,
				lifecycleStatus: "finalized",
			});
			expect(listed.items.find(({ id }) => id === draft.id)?.isLatest).toBe(
				false,
			);
		});

		it("stores bounded lifecycle summaries instead of membership arrays", async () => {
			const program = await insertProgram(`Audit ${randomUUID()}`);
			const repository = createVersionsRepository(client.db);
			const requestId = `req_${randomUUID()}`;
			await repository.createDraft({
				audit: audit(requestId),
				description: "Draft",
				expectedFileCount: 10_001,
				programId: program.id,
				versionMajor: 1,
				versionMinor: 0,
				versionNumber: "1.0.0",
				versionPatch: 0,
			});
			const [event] = await client.db
				.select({ after: auditEvents.afterJson })
				.from(auditEvents)
				.where(eq(auditEvents.requestId, requestId));
			expect(event?.after).toEqual({
				associatedFileCount: 0,
				expectedFileCount: 10_001,
				isActive: false,
				lifecycleStatus: "draft",
				versionNumber: "1.0.0",
			});
			expect(JSON.stringify(event?.after)).not.toContain("fileIds");
		});
	});
}
