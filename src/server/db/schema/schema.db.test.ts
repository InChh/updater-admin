import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import process from "node:process";

import { and, count, eq, inArray, or } from "drizzle-orm";
import { migrate } from "drizzle-orm/neon-serverless/migrator";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import {
	createDatabaseClient,
	type ManagedDatabaseClient,
} from "../client.server";
import {
	applications,
	applicationVersions,
	fileMetadata,
	systemSettings,
	versionFiles,
} from ".";
import { assertDisposableDatabaseGuard } from "./database-test-safety";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;

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
			let publicTables: string[];
			try {
				const result = await client.pool.query<{ table_name: string }>(
					`select table_name
					from information_schema.tables
					where table_schema = 'public' and table_type = 'BASE TABLE'
					order by table_name`,
				);
				publicTables = result.rows.map((row) => row.table_name);
			} catch (error) {
				await client.close();
				throw error;
			}
			if (publicTables.length > 0) {
				await client.close();
				throw new Error(
					`Disposable database public schema must be pristine: ${publicTables.join(", ")}`,
				);
			}

			await migrate(client.db, { migrationsFolder: resolve("drizzle") });

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
			const [version] = await client.db
				.insert(applicationVersions)
				.values({
					applicationId,
					createdBy: actorId,
					description,
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
