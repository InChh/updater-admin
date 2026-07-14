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
import { createFilesRepository } from "./files.server";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;

if (!testDatabaseUrl) {
	describe("files repository database integration", () => {
		it.skip("TEST_DATABASE_URL is absent; no disposable database was provisioned", () => {});
	});
} else {
	assertDisposableDatabaseGuard({
		confirmation: process.env.TEST_DATABASE_CONFIRM_DISPOSABLE,
		databaseUrl: process.env.DATABASE_URL,
		testDatabaseUrl,
	});

	describe("files repository database integration", () => {
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

		async function insertFile(path: string, createdAt?: Date) {
			const sha256 = randomUUID().replaceAll("-", "").repeat(2);
			const [file] = await client.db
				.insert(fileMetadata)
				.values({
					createdAt,
					createdBy: actorId,
					etag: `etag-${sha256}`,
					mimeType: "application/octet-stream",
					objectKey: `files-db-test/${sha256}/${path}`,
					path,
					sha256,
					size: 42n,
					updatedAt: createdAt,
					updatedBy: actorId,
				})
				.returning();
			if (!file) throw new Error("file insert returned no row");
			return file;
		}

		async function insertVersionOwner() {
			const [program] = await client.db
				.insert(applications)
				.values({
					createdBy: actorId,
					name: `Files ${randomUUID()}`,
					updatedBy: actorId,
				})
				.returning();
			if (!program) throw new Error("program insert returned no row");
			const [version] = await client.db
				.insert(applicationVersions)
				.values({
					applicationId: program.id,
					createdBy: actorId,
					description: "Files owner",
					updatedBy: actorId,
					versionMajor: 1,
					versionMinor: 0,
					versionNumber: "1.0.0",
					versionPatch: 0,
				})
				.returning();
			if (!version) throw new Error("version insert returned no row");
			return { program, version };
		}

		it("filters path metacharacters literally and preserves case", async () => {
			const suffix = randomUUID();
			const literal = await insertFile(`Root_%/${suffix}/app.bin`);
			await insertFile(`Root-xx/${suffix}/app.bin`);
			await insertFile(`root_%/${suffix}/app.bin`);
			const repository = createFilesRepository(client.db);

			const result = await repository.list({
				page: 1,
				pageSize: 20,
				path: "Root_%",
				sort: "path:asc",
			});
			expect(result.items.map(({ id }) => id)).toEqual([literal.id]);
			expect(result.total).toBe(1);
		});

		it("paginates whitelist sorts with deterministic path and id ordering", async () => {
			const timestamp = new Date("2026-07-15T06:00:00.000Z");
			const first = await insertFile(
				`ordered/${randomUUID()}/same.bin`,
				timestamp,
			);
			const second = await insertFile(first.path, timestamp);
			const repository = createFilesRepository(client.db);

			const ascPage = await repository.list({
				page: 1,
				pageSize: 20,
				path: first.path,
				sort: "path:asc",
			});
			expect(ascPage.items.map(({ id }) => id)).toEqual(
				[first.id, second.id].sort(),
			);
			const descPage = await repository.list({
				page: 1,
				pageSize: 20,
				path: first.path,
				sort: "createdAt:desc",
			});
			expect(descPage.items.map(({ id }) => id)).toEqual(
				[first.id, second.id].sort().reverse(),
			);
		});

		it("returns only live metadata related to the requested live version", async () => {
			const { program, version } = await insertVersionOwner();
			const live = await insertFile(`nested/${randomUUID()}/live.bin`);
			const deleted = await insertFile(`nested/${randomUUID()}/deleted.bin`);
			await client.db.insert(versionFiles).values([
				{ fileMetadataId: live.id, versionId: version.id },
				{ fileMetadataId: deleted.id, versionId: version.id },
			]);
			await client.db
				.update(fileMetadata)
				.set({ deletedAt: new Date(), deletedBy: actorId })
				.where(eq(fileMetadata.id, deleted.id));
			const repository = createFilesRepository(client.db);

			const page = await repository.listForVersion({
				page: 1,
				pageSize: 20,
				programId: program.id,
				sort: "path:asc",
				versionId: version.id,
			});
			expect(page).toMatchObject({
				items: [expect.objectContaining({ id: live.id })],
				total: 1,
			});
			expect(page.items[0]).not.toHaveProperty("objectKey");
			await expect(repository.findById(deleted.id)).resolves.toBeNull();
			await expect(repository.findById(live.id)).resolves.toMatchObject({
				id: live.id,
				objectEtag: live.etag,
				size: live.size,
			});
		});
	});
}
