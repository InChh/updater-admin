import { randomUUID } from "node:crypto";
import process from "node:process";

import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import {
	createDatabaseClient,
	type ManagedDatabaseClient,
} from "../client.server";
import { auditEvents, fileMetadata } from "../schema";
import { assertDisposableDatabaseGuard } from "../schema/database-test-safety";
import {
	createUploadsRepository,
	type RegisterUploadMetadataInput,
	UploadMetadataConflictRepositoryError,
} from "./uploads.server";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;

if (!testDatabaseUrl) {
	describe("uploads repository database integration", () => {
		it.skip("TEST_DATABASE_URL is absent; no disposable database was provisioned", () => {});
	});
} else {
	assertDisposableDatabaseGuard({
		confirmation: process.env.TEST_DATABASE_CONFIRM_DISPOSABLE,
		databaseUrl: process.env.DATABASE_URL,
		testDatabaseUrl,
	});

	describe("uploads repository database integration", () => {
		let client: ManagedDatabaseClient;
		const actorId = randomUUID();
		const audit = (requestId = `req_${randomUUID()}`) => ({
			actorId,
			ip: "203.0.113.8",
			requestId,
			userAgent: "vitest",
		});
		const file = (path = `uploads/${randomUUID()}/app.bin`) => {
			const sha256 = randomUUID().replaceAll("-", "").repeat(2);
			return {
				mimeType: "application/octet-stream",
				objectEtag: `etag-${sha256}`,
				objectKey: `releases/${sha256}/${encodeURIComponent(path)}`,
				path,
				sha256,
				size: 42n,
			} satisfies RegisterUploadMetadataInput;
		};

		beforeAll(() => {
			client = createDatabaseClient({ databaseUrl: testDatabaseUrl });
		});

		afterEach(async () => {
			await client.db
				.delete(auditEvents)
				.where(eq(auditEvents.actorId, actorId));
			await client.db
				.delete(fileMetadata)
				.where(eq(fileMetadata.createdBy, actorId));
		});

		afterAll(async () => {
			await client?.close();
		});

		it("returns one metadata row for concurrent matching completion replays", async () => {
			const repository = createUploadsRepository(client.db);
			const upload = file();
			const [first, second] = await Promise.all([
				repository.complete({ audit: audit(), files: [upload] }),
				repository.complete({ audit: audit(), files: [upload] }),
			]);

			expect(first[0]?.id).toBe(second[0]?.id);
			const stored = await client.db
				.select({ id: fileMetadata.id })
				.from(fileMetadata)
				.where(eq(fileMetadata.path, upload.path));
			expect(stored).toHaveLength(1);
		});

		it("completes reversed concurrent batches without deadlock and restores caller order", async () => {
			const repository = createUploadsRepository(client.db);
			const firstFile = file();
			const secondFile = file();
			const [forward, reverse] = await Promise.all([
				repository.complete({
					audit: audit(),
					files: [firstFile, secondFile],
				}),
				repository.complete({
					audit: audit(),
					files: [secondFile, firstFile],
				}),
			]);

			expect(forward.map(({ path }) => path)).toEqual([
				firstFile.path,
				secondFile.path,
			]);
			expect(reverse.map(({ path }) => path)).toEqual([
				secondFile.path,
				firstFile.path,
			]);
			expect(forward[0]?.id).toBe(reverse[1]?.id);
			expect(forward[1]?.id).toBe(reverse[0]?.id);
		});

		it("rejects conflicting proof and rolls back both metadata and its audit", async () => {
			const repository = createUploadsRepository(client.db);
			const upload = file();
			await repository.complete({ audit: audit(), files: [upload] });

			await expect(
				repository.complete({
					audit: audit(),
					files: [{ ...upload, objectEtag: `${upload.objectEtag}-other` }],
				}),
			).rejects.toBeInstanceOf(UploadMetadataConflictRepositoryError);

			const rolledBack = file();
			await expect(
				repository.complete({
					audit: audit("r".repeat(129)),
					files: [rolledBack],
				}),
			).rejects.toBeDefined();
			const rows = await client.db
				.select({ id: fileMetadata.id })
				.from(fileMetadata)
				.where(eq(fileMetadata.path, rolledBack.path));
			expect(rows).toEqual([]);
		});
	});
}
