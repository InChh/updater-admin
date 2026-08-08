import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import process from "node:process";

import { and, count, eq, inArray, or } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import {
	createDatabaseClient,
	type ManagedDatabaseClient,
} from "../client.server";
import { createRateLimitRepository } from "../repositories/rate-limit.server";
import {
	applications,
	applicationVersions,
	fileMetadata,
	rateLimitWindows,
	systemSettings,
	versionFiles,
} from ".";
import { assertDisposableDatabaseGuard } from "./database-test-safety";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const lifecycleMigrationStatements = readFileSync(
	resolve(process.cwd(), "drizzle/0002_shiny_adam_destine.sql"),
	"utf8",
)
	.split("--> statement-breakpoint")
	.map((statement) => statement.trim())
	.filter((statement) => statement.length > 0);

if (!testDatabaseUrl) {
	describe("database schema integration", () => {
		it.skip("TEST_DATABASE_URL is absent; no disposable database was provisioned", () => {});
	});
} else {
	assertDisposableDatabaseGuard({
		confirmation: process.env.TEST_DATABASE_CONFIRM_DISPOSABLE,
		databaseUrl: process.env.DATABASE_URL,
		testDatabaseUrl,
	});

	describe("database schema integration", () => {
		let client: ManagedDatabaseClient;
		const actorId = randomUUID();

		beforeAll(async () => {
			client = createDatabaseClient({ databaseUrl: testDatabaseUrl });
			const rowCounts = await Promise.all([
				client.db.select({ value: count() }).from(applications),
				client.db.select({ value: count() }).from(applicationVersions),
				client.db.select({ value: count() }).from(fileMetadata),
				client.db.select({ value: count() }).from(versionFiles),
				client.db.select({ value: count() }).from(systemSettings),
			]);
			const nonEmptyTables = [
				"applications",
				"application_versions",
				"file_metadata",
				"version_files",
				"system_settings",
			].filter((_, index) => Number(rowCounts[index]?.[0]?.value ?? 0) !== 0);

			if (nonEmptyTables.length > 0) {
				await client.close();
				throw new Error(
					`Disposable database business tables must be empty: ${nonEmptyTables.join(", ")}`,
				);
			}
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
			await client.db
				.delete(systemSettings)
				.where(
					and(eq(systemSettings.id, 1), eq(systemSettings.updatedBy, actorId)),
				);
		});

		afterAll(async () => {
			await client?.close();
		});

		async function insertApplication(name: string) {
			const [application] = await client.db
				.insert(applications)
				.values({
					createdBy: actorId,
					name,
					updatedBy: actorId,
				})
				.returning();
			if (!application) throw new Error("application insert returned no row");
			return application;
		}

		async function insertVersion(
			applicationId: string,
			description = "Required",
		) {
			const finalizedAt = new Date("2026-07-14T01:00:00.000Z");
			const [version] = await client.db
				.insert(applicationVersions)
				.values({
					applicationId,
					createdBy: actorId,
					description,
					finalizedAt,
					lifecycleStatus: "finalized",
					updatedBy: actorId,
					versionMajor: 1,
					versionMinor: 2,
					versionNumber: "1.2.3",
					versionPatch: 3,
				})
				.returning();
			if (!version) throw new Error("version insert returned no row");
			return version;
		}

		async function insertFile(path: string, sha256: string) {
			const [file] = await client.db
				.insert(fileMetadata)
				.values({
					createdBy: actorId,
					mimeType: "application/octet-stream",
					objectKey: `test/${sha256}/${path}`,
					path,
					sha256,
					size: 10n,
					updatedBy: actorId,
				})
				.returning();
			if (!file) throw new Error("file insert returned no row");
			return file;
		}

		it("backfills a pre-lifecycle active version as finalized without an expected count", async () => {
			const connection = await client.pool.connect();
			const existingVersionId = randomUUID();
			const createdAt = new Date("2026-07-13T12:34:56.000Z");

			try {
				await connection.query("begin");
				await connection.query("set local search_path to pg_temp");
				await connection.query(`
					create temporary table "application_versions" (
						"id" uuid primary key,
						"application_id" uuid not null,
						"version_major" integer not null,
						"version_minor" integer not null,
						"version_patch" integer not null,
						"is_active" boolean default false not null,
						"created_at" timestamp with time zone not null,
						"deleted_at" timestamp with time zone
					) on commit drop
				`);
				await connection.query(`
					create index "application_versions_latest_idx"
					on "application_versions" (
						"application_id",
						"is_active",
						"version_major" desc,
						"version_minor" desc,
						"version_patch" desc
					)
					where "deleted_at" is null
				`);
				await connection.query(
					`insert into "application_versions" (
						"id", "application_id", "version_major", "version_minor",
						"version_patch", "is_active", "created_at"
					) values ($1, $2, 1, 2, 3, true, $3)`,
					[existingVersionId, randomUUID(), createdAt],
				);

				for (const statement of lifecycleMigrationStatements) {
					await connection.query(statement);
				}

				const migrated = await connection.query<{
					expected_file_count: number | null;
					finalized_at_matches: boolean;
					is_active: boolean;
					lifecycle_status: string;
				}>(
					`select
						"expected_file_count",
						"finalized_at" = "created_at" as "finalized_at_matches",
						"is_active",
						"lifecycle_status"
					from "application_versions"
					where "id" = $1`,
					[existingVersionId],
				);
				expect(migrated.rows).toEqual([
					{
						expected_file_count: null,
						finalized_at_matches: true,
						is_active: true,
						lifecycle_status: "finalized",
					},
				]);

				await expect(
					connection.query(
						`insert into "application_versions" (
							"id", "application_id", "version_major", "version_minor",
							"version_patch", "expected_file_count", "is_active", "created_at"
						) values ($1, $2, 2, 0, 0, 1, true, $3)`,
						[randomUUID(), randomUUID(), createdAt],
					),
				).rejects.toThrow();
			} finally {
				await connection.query("rollback");
				connection.release();
			}
		});

		it("defaults new versions to inactive drafts and enforces lifecycle consistency", async () => {
			const application = await insertApplication("Lifecycle constraints");
			const [draft] = await client.db
				.insert(applicationVersions)
				.values({
					applicationId: application.id,
					createdBy: actorId,
					description: "Draft",
					expectedFileCount: 2,
					updatedBy: actorId,
					versionMajor: 1,
					versionMinor: 0,
					versionNumber: "1.0.0",
					versionPatch: 0,
				})
				.returning();
			expect(draft).toMatchObject({
				expectedFileCount: 2,
				finalizedAt: null,
				isActive: false,
				lifecycleStatus: "draft",
			});

			await expect(
				client.db.insert(applicationVersions).values({
					applicationId: application.id,
					createdBy: actorId,
					description: "Active draft",
					expectedFileCount: 1,
					isActive: true,
					updatedBy: actorId,
					versionMajor: 1,
					versionMinor: 0,
					versionNumber: "1.0.1",
					versionPatch: 1,
				}),
			).rejects.toThrow();

			const finalizedAt = new Date("2026-07-14T02:00:00.000Z");
			const [activeFinalized] = await client.db
				.insert(applicationVersions)
				.values({
					applicationId: application.id,
					createdBy: actorId,
					description: "Active finalized",
					expectedFileCount: null,
					finalizedAt,
					isActive: true,
					lifecycleStatus: "finalized",
					updatedBy: actorId,
					versionMajor: 1,
					versionMinor: 0,
					versionNumber: "1.0.2",
					versionPatch: 2,
				})
				.returning();
			expect(activeFinalized).toMatchObject({
				expectedFileCount: null,
				finalizedAt,
				isActive: true,
				lifecycleStatus: "finalized",
			});
		});

		it("enforces live application-name uniqueness but permits reuse after soft deletion", async () => {
			const application = await insertApplication("Desktop");
			await expect(insertApplication("Desktop")).rejects.toThrow();

			await client.db
				.update(applications)
				.set({ deletedAt: new Date(), deletedBy: actorId })
				.where(eq(applications.id, application.id));
			await expect(insertApplication("Desktop")).resolves.toBeDefined();
		});

		it("enforces canonical nonnegative and live-unique numeric versions", async () => {
			const application = await insertApplication("Mobile");
			const version = await insertVersion(application.id);

			await expect(insertVersion(application.id)).rejects.toThrow();
			await expect(
				client.db.insert(applicationVersions).values({
					applicationId: application.id,
					createdBy: actorId,
					description: "Invalid",
					updatedBy: actorId,
					versionMajor: -1,
					versionMinor: 0,
					versionNumber: "-1.0.0",
					versionPatch: 0,
				}),
			).rejects.toThrow();
			await expect(
				client.db.insert(applicationVersions).values({
					applicationId: application.id,
					createdBy: actorId,
					description: "Invalid",
					updatedBy: actorId,
					versionMajor: 1,
					versionMinor: 2,
					versionNumber: "01.2.3",
					versionPatch: 3,
				}),
			).rejects.toThrow();

			await client.db
				.update(applicationVersions)
				.set({ deletedAt: new Date(), deletedBy: actorId })
				.where(eq(applicationVersions.id, version.id));
			await expect(insertVersion(application.id)).resolves.toBeDefined();
		});

		it("enforces file identity, lowercase SHA-256, and nonnegative sizes", async () => {
			const sha256 = "a".repeat(64);
			const file = await insertFile("bin/app.exe", sha256);
			await expect(insertFile("bin/app.exe", sha256)).rejects.toThrow();
			await expect(insertFile("bin/bad.exe", "A".repeat(64))).rejects.toThrow();
			await expect(
				client.db.insert(fileMetadata).values({
					createdBy: actorId,
					mimeType: "application/octet-stream",
					objectKey: "test/negative",
					path: "bin/negative.exe",
					sha256: "b".repeat(64),
					size: -1n,
					updatedBy: actorId,
				}),
			).rejects.toThrow();

			await client.db
				.update(fileMetadata)
				.set({ deletedAt: new Date(), deletedBy: actorId })
				.where(eq(fileMetadata.id, file.id));
			await expect(insertFile("bin/app.exe", sha256)).resolves.toBeDefined();
		});

		it("atomically increments a shared fixed-window rate limit", async () => {
			const endpoint = `schema-test:${randomUUID()}`;
			const repository = createRateLimitRepository(client.db);
			const now = new Date("2026-07-14T01:07:13.999Z");

			try {
				const decisions = await Promise.all(
					Array.from({ length: 20 }, () =>
						repository.consume({
							cost: 2,
							endpoint,
							limit: 100,
							now,
							subjectKey: actorId,
							windowSeconds: 15 * 60,
						}),
					),
				);
				expect(
					decisions.map((decision) => decision.count).sort((a, b) => a - b),
				).toEqual(Array.from({ length: 20 }, (_, index) => (index + 1) * 2));
				const rows = await client.db
					.select({ count: rateLimitWindows.count })
					.from(rateLimitWindows)
					.where(eq(rateLimitWindows.endpoint, endpoint));
				expect(rows).toEqual([{ count: 40 }]);
			} finally {
				await client.db
					.delete(rateLimitWindows)
					.where(eq(rateLimitWindows.endpoint, endpoint));
			}
		});

		it("enforces singleton system settings and approved locale/page-size values", async () => {
			const [settings] = await client.db
				.insert(systemSettings)
				.values({ updatedBy: actorId })
				.returning();
			expect(settings).toMatchObject({
				defaultLocale: "zh-CN",
				defaultPageSize: 20,
				id: 1,
				rowVersion: 1n,
				systemName: "版本管理系统",
			});
			await expect(
				client.db.insert(systemSettings).values({ id: 2 }),
			).rejects.toThrow();
			await expect(
				client.db
					.update(systemSettings)
					.set({ defaultPageSize: 25 })
					.where(eq(systemSettings.id, 1)),
			).rejects.toThrow();
			await expect(
				client.db
					.update(systemSettings)
					.set({ defaultLocale: "en-US" })
					.where(eq(systemSettings.id, 1)),
			).rejects.toThrow();
		});

		it("supports replacing a version file set with an explicit empty set in one transaction", async () => {
			const application = await insertApplication("Remove all files");
			const version = await insertVersion(application.id);
			const first = await insertFile("first.bin", "c".repeat(64));
			const second = await insertFile("second.bin", "d".repeat(64));
			await client.db.insert(versionFiles).values([
				{ fileMetadataId: first.id, versionId: version.id },
				{ fileMetadataId: second.id, versionId: version.id },
			]);

			await client.db.transaction(async (transaction) => {
				await transaction
					.delete(versionFiles)
					.where(eq(versionFiles.versionId, version.id));
			});

			const remaining = await client.db
				.select()
				.from(versionFiles)
				.where(
					and(
						eq(versionFiles.versionId, version.id),
						eq(versionFiles.fileMetadataId, first.id),
					),
				);
			expect(remaining).toEqual([]);
			const allRemaining = await client.db
				.select()
				.from(versionFiles)
				.where(eq(versionFiles.versionId, version.id));
			expect(allRemaining).toEqual([]);
		});
	});
}
