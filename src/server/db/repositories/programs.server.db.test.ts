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
	createProgramsRepository,
	ProgramNameConflictRepositoryError,
	ProgramStaleWriteRepositoryError,
} from "./programs.server";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;

if (!testDatabaseUrl) {
	describe("programs repository database integration", () => {
		it.skip("TEST_DATABASE_URL is absent; no disposable database was provisioned", () => {});
	});
} else {
	assertDisposableDatabaseGuard({
		confirmation: process.env.TEST_DATABASE_CONFIRM_DISPOSABLE,
		databaseUrl: process.env.DATABASE_URL,
		testDatabaseUrl,
	});

	describe("programs repository database integration", () => {
		let client: ManagedDatabaseClient;
		const actorId = randomUUID();
		const audit = (requestId: string) => ({
			actorId,
			ip: "203.0.113.8",
			requestId,
			userAgent: "programs-db-test",
		});
		const insertDeleteAggregate = async (name: string) => {
			const [application] = await client.db
				.insert(applications)
				.values({ createdBy: actorId, name, updatedBy: actorId })
				.returning();
			if (!application) throw new Error("application insert returned no row");
			const [version] = await client.db
				.insert(applicationVersions)
				.values({
					applicationId: application.id,
					createdBy: actorId,
					description: "Delete integration fixture",
					updatedBy: actorId,
					versionMajor: 1,
					versionMinor: 0,
					versionNumber: "1.0.0",
					versionPatch: 0,
				})
				.returning();
			if (!version) throw new Error("version insert returned no row");
			const sha256 = randomUUID().replaceAll("-", "").repeat(2);
			const [file] = await client.db
				.insert(fileMetadata)
				.values({
					createdBy: actorId,
					mimeType: "application/octet-stream",
					objectKey: `programs-db-test/${sha256}`,
					path: `${sha256}.bin`,
					sha256,
					size: 10n,
					updatedBy: actorId,
				})
				.returning();
			if (!file) throw new Error("file insert returned no row");
			await client.db.insert(versionFiles).values({
				fileMetadataId: file.id,
				versionId: version.id,
			});
			return { application, file, version };
		};

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
				.where(eq(applications.createdBy, actorId));
		});

		afterAll(async () => {
			await client?.close();
		});

		it("allows exactly one concurrent create for a live name and audits only the winner", async () => {
			const repository = createProgramsRepository(client.db);
			const name = `Concurrent ${randomUUID()}`;
			const results = await Promise.allSettled([
				repository.create({
					audit: audit(`req_${randomUUID()}`),
					description: "first",
					name,
				}),
				repository.create({
					audit: audit(`req_${randomUUID()}`),
					description: "second",
					name,
				}),
			]);

			const fulfilled = results.filter(
				(result) => result.status === "fulfilled",
			);
			const rejected = results.filter(
				(result): result is PromiseRejectedResult =>
					result.status === "rejected",
			);
			expect(fulfilled).toHaveLength(1);
			expect(rejected).toHaveLength(1);
			expect(rejected[0]?.reason).toBeInstanceOf(
				ProgramNameConflictRepositoryError,
			);

			const liveRows = await client.db
				.select({ id: applications.id })
				.from(applications)
				.where(eq(applications.name, name));
			const audits = await client.db
				.select({ action: auditEvents.action })
				.from(auditEvents)
				.where(eq(auditEvents.actorId, actorId));
			expect(liveRows).toHaveLength(1);
			expect(audits).toEqual([{ action: "program.created" }]);
		});

		it("serializes concurrent writes so only one matching ETag can commit", async () => {
			const repository = createProgramsRepository(client.db);
			const created = await repository.create({
				audit: audit(`req_${randomUUID()}`),
				description: null,
				name: `ETag ${randomUUID()}`,
			});
			const results = await Promise.allSettled([
				repository.update({
					audit: audit(`req_${randomUUID()}`),
					expectedRowVersion: created.rowVersion,
					id: created.id,
					name: "Winner A",
					now: new Date("2026-07-14T10:00:00.000Z"),
				}),
				repository.update({
					audit: audit(`req_${randomUUID()}`),
					expectedRowVersion: created.rowVersion,
					id: created.id,
					name: "Winner B",
					now: new Date("2026-07-14T10:00:01.000Z"),
				}),
			]);

			const fulfilled = results.filter(
				(result) => result.status === "fulfilled",
			);
			const rejected = results.filter(
				(result): result is PromiseRejectedResult =>
					result.status === "rejected",
			);
			expect(fulfilled).toHaveLength(1);
			expect(rejected).toHaveLength(1);
			expect(rejected[0]?.reason).toBeInstanceOf(
				ProgramStaleWriteRepositoryError,
			);

			const current = await repository.findById(created.id);
			expect(current?.rowVersion).toBe(created.rowVersion + 1n);
			expect(["Winner A", "Winner B"]).toContain(current?.name);
			const audits = await client.db
				.select({ action: auditEvents.action })
				.from(auditEvents)
				.where(eq(auditEvents.actorId, actorId));
			expect(audits.map(({ action }) => action).sort()).toEqual([
				"program.created",
				"program.updated",
			]);
		});

		it("soft-deletes the aggregate while preserving file metadata and relations", async () => {
			const aggregate = await insertDeleteAggregate(
				`Delete aggregate ${randomUUID()}`,
			);
			const repository = createProgramsRepository(client.db);
			const deletedAt = new Date("2026-07-14T12:00:00.000Z");

			await expect(
				repository.delete({
					audit: audit(`req_${randomUUID()}`),
					expectedRowVersion: aggregate.application.rowVersion,
					id: aggregate.application.id,
					now: deletedAt,
				}),
			).resolves.toEqual({ affectedVersionCount: 1 });

			const [application] = await client.db
				.select()
				.from(applications)
				.where(eq(applications.id, aggregate.application.id));
			const [version] = await client.db
				.select()
				.from(applicationVersions)
				.where(eq(applicationVersions.id, aggregate.version.id));
			const [file] = await client.db
				.select()
				.from(fileMetadata)
				.where(eq(fileMetadata.id, aggregate.file.id));
			const relations = await client.db
				.select()
				.from(versionFiles)
				.where(eq(versionFiles.versionId, aggregate.version.id));
			const [event] = await client.db
				.select({ after: auditEvents.afterJson })
				.from(auditEvents)
				.where(eq(auditEvents.resourceId, aggregate.application.id));

			expect(application).toMatchObject({
				deletedAt,
				deletedBy: actorId,
				rowVersion: aggregate.application.rowVersion + 1n,
			});
			expect(version).toMatchObject({ deletedAt, deletedBy: actorId });
			expect(file).toMatchObject({ deletedAt: null, deletedBy: null });
			expect(relations).toHaveLength(1);
			expect(event?.after).toMatchObject({
				affectedVersionCount: 1,
				deletedAt: deletedAt.toISOString(),
				deletedBy: actorId,
			});
		});

		it("rolls back program and version deletion when the audit insert fails", async () => {
			const aggregate = await insertDeleteAggregate(
				`Delete rollback ${randomUUID()}`,
			);
			const repository = createProgramsRepository(client.db);

			await expect(
				repository.delete({
					audit: audit("r".repeat(129)),
					expectedRowVersion: aggregate.application.rowVersion,
					id: aggregate.application.id,
					now: new Date("2026-07-14T12:00:00.000Z"),
				}),
			).rejects.toBeDefined();

			const [application] = await client.db
				.select()
				.from(applications)
				.where(eq(applications.id, aggregate.application.id));
			const [version] = await client.db
				.select()
				.from(applicationVersions)
				.where(eq(applicationVersions.id, aggregate.version.id));
			expect(application).toMatchObject({
				deletedAt: null,
				rowVersion: aggregate.application.rowVersion,
			});
			expect(version).toMatchObject({
				deletedAt: null,
				rowVersion: aggregate.version.rowVersion,
			});
		});

		it("treats filter metacharacters literally and preserves case", async () => {
			const repository = createProgramsRepository(client.db);
			const suffix = randomUUID();
			const literal = await repository.create({
				audit: audit(`req_${randomUUID()}`),
				description: null,
				name: `Desk_%_${suffix}`,
			});
			await repository.create({
				audit: audit(`req_${randomUUID()}`),
				description: null,
				name: `Desk-xx-${suffix}`,
			});

			const literalResult = await repository.list({
				name: "_%",
				page: 1,
				pageSize: 20,
				sort: "createdAt:desc",
			});
			expect(literalResult.items.map(({ id }) => id)).toEqual([literal.id]);

			const differentCase = await repository.list({
				name: "desk_%",
				page: 1,
				pageSize: 20,
				sort: "createdAt:desc",
			});
			expect(differentCase.items).toEqual([]);
		});
	});
}
