import { randomUUID } from "node:crypto";
import process from "node:process";

import { asc, eq, inArray, or } from "drizzle-orm";
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
	VersionFilesNotFoundRepositoryError,
	VersionNotGreaterRepositoryError,
	VersionNumberConflictRepositoryError,
	VersionStaleWriteRepositoryError,
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
					etag: `etag-${sha256}`,
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

		it("serializes concurrent creates against the historical numeric maximum", async () => {
			const program = await insertProgram(`Concurrent ${randomUUID()}`);
			const repository = createVersionsRepository(client.db);
			const candidate = {
				description: "Concurrent candidate",
				fileIds: [],
				isActive: false,
				programId: program.id,
				versionMajor: 1,
				versionMinor: 0,
				versionNumber: "1.0.0",
				versionPatch: 0,
			} as const;
			const results = await Promise.allSettled([
				repository.create({ ...candidate, audit: audit() }),
				repository.create({ ...candidate, audit: audit() }),
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
			const rows = await client.db
				.select({ versionNumber: applicationVersions.versionNumber })
				.from(applicationVersions)
				.where(eq(applicationVersions.applicationId, program.id));
			expect(rows).toEqual([{ versionNumber: "1.0.0" }]);
		});

		it("keeps multiple versions active and moves exactly one numeric latest marker", async () => {
			const program = await insertProgram(`Activation ${randomUUID()}`);
			const repository = createVersionsRepository(client.db);
			const first = await repository.create({
				audit: audit(),
				description: "First",
				fileIds: [],
				isActive: true,
				programId: program.id,
				versionMajor: 1,
				versionMinor: 9,
				versionNumber: "1.9.99",
				versionPatch: 99,
			});
			const second = await repository.create({
				audit: audit(),
				description: "Second",
				fileIds: [],
				isActive: true,
				programId: program.id,
				versionMajor: 1,
				versionMinor: 10,
				versionNumber: "1.10.0",
				versionPatch: 0,
			});
			const third = await repository.create({
				audit: audit(),
				description: "Third",
				fileIds: [],
				isActive: false,
				programId: program.id,
				versionMajor: 2,
				versionMinor: 0,
				versionNumber: "2.0.0",
				versionPatch: 0,
			});

			const initial = await repository.list({
				page: 1,
				pageSize: 20,
				programId: program.id,
				sort: "createdAt:asc",
			});
			expect(initial.items.filter(({ isLatest }) => isLatest)).toEqual([
				expect.objectContaining({ id: second.id }),
			]);

			const activated = await repository.setActivation({
				audit: audit(),
				expectedRowVersion: third.rowVersion,
				id: third.id,
				isActive: true,
				now: new Date("2026-07-15T01:00:00.000Z"),
				programId: program.id,
			});
			expect(activated).toMatchObject({ isLatest: true, rowVersion: 2n });
			const activeRows = await client.db
				.select({
					id: applicationVersions.id,
					isActive: applicationVersions.isActive,
				})
				.from(applicationVersions)
				.where(eq(applicationVersions.applicationId, program.id));
			expect(activeRows).toEqual(
				expect.arrayContaining([
					{ id: first.id, isActive: true },
					{ id: second.id, isActive: true },
					{ id: third.id, isActive: true },
				]),
			);

			const disabled = await repository.setActivation({
				audit: audit(),
				expectedRowVersion: activated.rowVersion,
				id: third.id,
				isActive: false,
				now: new Date("2026-07-15T01:01:00.000Z"),
				programId: program.id,
			});
			expect(disabled.isLatest).toBe(false);
			const final = await repository.list({
				page: 1,
				pageSize: 20,
				programId: program.id,
				sort: "createdAt:asc",
			});
			expect(final.items.filter(({ isLatest }) => isLatest)).toEqual([
				expect.objectContaining({ id: second.id }),
			]);
		});

		it("distinguishes omitted fileIds from an explicit remove-all replacement", async () => {
			const program = await insertProgram(`Relations ${randomUUID()}`);
			const [firstFile, secondFile] = await Promise.all([
				insertFile(`relations/${randomUUID()}/a.bin`),
				insertFile(`relations/${randomUUID()}/b.bin`),
			]);
			const repository = createVersionsRepository(client.db);
			const created = await repository.create({
				audit: audit(),
				description: "Original",
				fileIds: [secondFile.id, firstFile.id],
				isActive: false,
				programId: program.id,
				versionMajor: 1,
				versionMinor: 0,
				versionNumber: "1.0.0",
				versionPatch: 0,
			});
			const preserveRequestId = `req_${randomUUID()}`;
			const preserved = await repository.update({
				audit: audit(preserveRequestId),
				description: "Description only",
				expectedRowVersion: created.rowVersion,
				id: created.id,
				now: new Date("2026-07-15T02:00:00.000Z"),
				programId: program.id,
			});
			expect(preserved.fileIds).toEqual([firstFile.id, secondFile.id].sort());

			const removeRequestId = `req_${randomUUID()}`;
			const removed = await repository.update({
				audit: audit(removeRequestId),
				expectedRowVersion: preserved.rowVersion,
				fileIds: [],
				id: created.id,
				now: new Date("2026-07-15T02:01:00.000Z"),
				programId: program.id,
			});
			expect(removed.fileIds).toEqual([]);
			const relations = await client.db
				.select()
				.from(versionFiles)
				.where(eq(versionFiles.versionId, created.id));
			expect(relations).toEqual([]);
			const [event] = await client.db
				.select({
					after: auditEvents.afterJson,
					before: auditEvents.beforeJson,
				})
				.from(auditEvents)
				.where(eq(auditEvents.requestId, removeRequestId));
			expect(event).toMatchObject({
				after: { fileIds: [] },
				before: { fileIds: [firstFile.id, secondFile.id].sort() },
			});
		});

		it("rolls back the whole aggregate when a replacement file is missing or audit append fails", async () => {
			const program = await insertProgram(`Rollback ${randomUUID()}`);
			const file = await insertFile(`rollback/${randomUUID()}/app.bin`);
			const repository = createVersionsRepository(client.db);
			const created = await repository.create({
				audit: audit(),
				description: "Original",
				fileIds: [file.id],
				isActive: false,
				programId: program.id,
				versionMajor: 1,
				versionMinor: 0,
				versionNumber: "1.0.0",
				versionPatch: 0,
			});

			await expect(
				repository.update({
					audit: audit(),
					description: "Must roll back",
					expectedRowVersion: created.rowVersion,
					fileIds: [file.id, randomUUID()],
					id: created.id,
					now: new Date("2026-07-15T03:00:00.000Z"),
					programId: program.id,
				}),
			).rejects.toBeInstanceOf(VersionFilesNotFoundRepositoryError);

			await expect(
				repository.update({
					audit: audit("r".repeat(129)),
					expectedRowVersion: created.rowVersion,
					fileIds: [],
					id: created.id,
					now: new Date("2026-07-15T03:01:00.000Z"),
					programId: program.id,
				}),
			).rejects.toBeDefined();

			const detail = await repository.findById(program.id, created.id);
			expect(detail).toMatchObject({
				description: "Original",
				fileIds: [file.id],
				rowVersion: created.rowVersion,
			});
		});

		it("preserves files and relation history on soft delete and never permits version rollback", async () => {
			const program = await insertProgram(`Delete ${randomUUID()}`);
			const file = await insertFile(`delete/${randomUUID()}/app.bin`);
			const repository = createVersionsRepository(client.db);
			const first = await repository.create({
				audit: audit(),
				description: "First",
				fileIds: [],
				isActive: true,
				programId: program.id,
				versionMajor: 1,
				versionMinor: 0,
				versionNumber: "1.0.0",
				versionPatch: 0,
			});
			const second = await repository.create({
				audit: audit(),
				description: "Second",
				fileIds: [file.id],
				isActive: true,
				programId: program.id,
				versionMajor: 2,
				versionMinor: 0,
				versionNumber: "2.0.0",
				versionPatch: 0,
			});
			await expect(
				repository.update({
					audit: audit(),
					expectedRowVersion: second.rowVersion,
					id: second.id,
					now: new Date("2026-07-15T03:58:00.000Z"),
					programId: program.id,
					versionMajor: 1,
					versionMinor: 0,
					versionNumber: "1.0.0",
					versionPatch: 0,
				}),
			).rejects.toBeInstanceOf(VersionNumberConflictRepositoryError);
			await expect(
				repository.update({
					audit: audit(),
					expectedRowVersion: second.rowVersion,
					id: second.id,
					now: new Date("2026-07-15T03:59:00.000Z"),
					programId: program.id,
					versionMajor: 1,
					versionMinor: 5,
					versionNumber: "1.5.0",
					versionPatch: 0,
				}),
			).rejects.toBeInstanceOf(VersionNotGreaterRepositoryError);
			const deleteRequestId = `req_${randomUUID()}`;
			await repository.delete({
				audit: audit(deleteRequestId),
				expectedRowVersion: second.rowVersion,
				id: second.id,
				now: new Date("2026-07-15T04:00:00.000Z"),
				programId: program.id,
			});

			const [storedFile] = await client.db
				.select()
				.from(fileMetadata)
				.where(eq(fileMetadata.id, file.id));
			const relations = await client.db
				.select()
				.from(versionFiles)
				.where(eq(versionFiles.versionId, second.id));
			expect(storedFile).toMatchObject({ deletedAt: null });
			expect(relations).toEqual([
				{ fileMetadataId: file.id, versionId: second.id },
			]);
			const page = await repository.list({
				page: 1,
				pageSize: 20,
				programId: program.id,
				sort: "createdAt:asc",
			});
			expect(page.items).toEqual([
				expect.objectContaining({ id: first.id, isLatest: true }),
			]);
			const [event] = await client.db
				.select({ after: auditEvents.afterJson })
				.from(auditEvents)
				.where(eq(auditEvents.requestId, deleteRequestId));
			expect(event?.after).toMatchObject({ fileIds: [file.id] });

			await expect(
				repository.create({
					audit: audit(),
					description: "No reuse",
					fileIds: [],
					isActive: false,
					programId: program.id,
					versionMajor: 2,
					versionMinor: 0,
					versionNumber: "2.0.0",
					versionPatch: 0,
				}),
			).rejects.toMatchObject({ currentMax: "2.0.0" });
			await expect(
				repository.create({
					audit: audit(),
					description: "Next",
					fileIds: [],
					isActive: false,
					programId: program.id,
					versionMajor: 2,
					versionMinor: 0,
					versionNumber: "2.0.1",
					versionPatch: 1,
				}),
			).resolves.toMatchObject({ versionNumber: "2.0.1" });
		});

		it("allows only one mutation to consume a matching row version", async () => {
			const program = await insertProgram(`ETag ${randomUUID()}`);
			const repository = createVersionsRepository(client.db);
			const created = await repository.create({
				audit: audit(),
				description: "Original",
				fileIds: [],
				isActive: false,
				programId: program.id,
				versionMajor: 1,
				versionMinor: 0,
				versionNumber: "1.0.0",
				versionPatch: 0,
			});
			const results = await Promise.allSettled([
				repository.update({
					audit: audit(),
					description: "Winner A",
					expectedRowVersion: created.rowVersion,
					id: created.id,
					now: new Date("2026-07-15T05:00:00.000Z"),
					programId: program.id,
				}),
				repository.update({
					audit: audit(),
					description: "Winner B",
					expectedRowVersion: created.rowVersion,
					id: created.id,
					now: new Date("2026-07-15T05:01:00.000Z"),
					programId: program.id,
				}),
			]);
			expect(
				results.filter(({ status }) => status === "fulfilled"),
			).toHaveLength(1);
			const rejected = results.find(
				(result): result is PromiseRejectedResult =>
					result.status === "rejected",
			);
			expect(rejected?.reason).toBeInstanceOf(VersionStaleWriteRepositoryError);
			const [current] = await client.db
				.select({
					description: applicationVersions.description,
					rowVersion: applicationVersions.rowVersion,
				})
				.from(applicationVersions)
				.where(eq(applicationVersions.id, created.id))
				.orderBy(asc(applicationVersions.id));
			expect(current?.rowVersion).toBe(created.rowVersion + 1n);
			expect(["Winner A", "Winner B"]).toContain(current?.description);
		});
	});
}
