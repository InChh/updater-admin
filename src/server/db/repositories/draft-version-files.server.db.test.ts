import { randomUUID } from "node:crypto";
import process from "node:process";

import { count, eq, inArray, or } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { createDraftVersionFilesService } from "../../domain/draft-version-files.server";

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
	createDraftVersionFilesRepository,
	DraftVersionFinalizedRepositoryError,
	DraftVersionPathConflictRepositoryError,
} from "./draft-version-files.server";
import type { RegisterUploadMetadataInput } from "./uploads.server";
import { createVersionsRepository } from "./versions.server";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;

if (!testDatabaseUrl) {
	describe("draft version files repository database integration", () => {
		it.skip("TEST_DATABASE_URL is absent; no disposable database was provisioned", () => {});
	});
} else {
	assertDisposableDatabaseGuard({
		confirmation: process.env.TEST_DATABASE_CONFIRM_DISPOSABLE,
		databaseUrl: process.env.DATABASE_URL,
		testDatabaseUrl,
	});

	describe("draft version files repository database integration", () => {
		let client: ManagedDatabaseClient;
		const actorId = randomUUID();
		const audit = (requestId = `req_${randomUUID()}`) => ({
			actorId,
			ip: "203.0.113.8",
			requestId,
			userAgent: "draft-files-db-test",
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

		async function insertVersion(
			programId: string,
			versionMajor: number,
			lifecycleStatus: "draft" | "finalized",
			expectedFileCount: number | null,
		) {
			const [version] = await client.db
				.insert(applicationVersions)
				.values({
					applicationId: programId,
					createdBy: actorId,
					description: lifecycleStatus,
					expectedFileCount,
					finalizedAt: lifecycleStatus === "finalized" ? new Date() : null,
					isActive: false,
					lifecycleStatus,
					updatedBy: actorId,
					versionMajor,
					versionMinor: 0,
					versionNumber: `${versionMajor}.0.0`,
					versionPatch: 0,
				})
				.returning();
			if (!version) throw new Error("version insert returned no row");
			return version;
		}

		function upload(
			path = `app-${randomUUID()}.bin`,
		): RegisterUploadMetadataInput {
			const sha256 = randomUUID().replaceAll("-", "").repeat(2);
			return {
				mimeType: "application/octet-stream",
				objectKey: `releases/${sha256}/${path}`,
				path,
				sha256,
				size: 42n,
			};
		}

		async function insertFile(input: RegisterUploadMetadataInput) {
			const [file] = await client.db
				.insert(fileMetadata)
				.values({
					createdBy: actorId,
					mimeType: input.mimeType,
					objectKey: input.objectKey,
					path: input.path,
					sha256: input.sha256,
					size: input.size,
					updatedBy: actorId,
				})
				.returning();
			if (!file) throw new Error("file insert returned no row");
			return file;
		}

		it("reuses any live metadata row globally by path, hash, and size", async () => {
			const otherProgram = await insertProgram(`Other ${randomUUID()}`);
			const otherDraft = await insertVersion(otherProgram.id, 1, "draft", 1);
			const input = upload();
			const stored = await insertFile(input);
			const repository = createDraftVersionFilesRepository(client.db);

			await expect(
				repository.resolve({
					audit: audit(),
					files: [input],
					programId: otherProgram.id,
					versionId: otherDraft.id,
				}),
			).resolves.toEqual([
				{
					canonicalMimeType: stored.mimeType,
					path: input.path,
					status: "reused",
				},
			]);
			const [relation] = await client.db
				.select()
				.from(versionFiles)
				.where(eq(versionFiles.versionId, otherDraft.id));
			expect(relation?.fileMetadataId).toBe(stored.id);
		});

		it("completes and associates idempotently while rejecting same-path changes", async () => {
			const program = await insertProgram(`Replay ${randomUUID()}`);
			const draft = await insertVersion(program.id, 1, "draft", 1);
			const repository = createDraftVersionFilesRepository(client.db);
			const first = upload();
			const completed = await repository.complete({
				audit: audit(),
				files: [first],
				programId: program.id,
				versionId: draft.id,
			});
			const replay = await repository.complete({
				audit: audit(),
				files: [first],
				programId: program.id,
				versionId: draft.id,
			});
			expect(replay[0]?.id).toBe(completed[0]?.id);
			const [relationCount] = await client.db
				.select({ value: count() })
				.from(versionFiles)
				.where(eq(versionFiles.versionId, draft.id));
			expect(Number(relationCount?.value ?? 0)).toBe(1);

			await expect(
				repository.complete({
					audit: audit(),
					files: [upload(first.path)],
					programId: program.id,
					versionId: draft.id,
				}),
			).rejects.toBeInstanceOf(DraftVersionPathConflictRepositoryError);
		});

		it("reuses finalized metadata without OSS access and preserves its stored MIME", async () => {
			const program = await insertProgram(`Reuse ${randomUUID()}`);
			const source = await insertVersion(program.id, 1, "finalized", null);
			const draft = await insertVersion(program.id, 2, "draft", 1);
			const browserFile = upload(`reused-${randomUUID()}.bin`);
			const stored = await insertFile({
				...browserFile,
				mimeType: "application/x-stored",
			});
			await client.db.insert(versionFiles).values({
				fileMetadataId: stored.id,
				versionId: source.id,
			});

			const service = createDraftVersionFilesService({
				getMetadataClient: () => {
					throw new Error("Resolve must not initialize the OSS client.");
				},
				repository: createDraftVersionFilesRepository(client.db),
				uploadPrefix: "releases/",
			});
			const requestFile = {
				mimeType: browserFile.mimeType,
				path: browserFile.path,
				sha256: browserFile.sha256,
				size: browserFile.size.toString(),
			};

			await expect(
				service.resolve(
					program.id,
					draft.id,
					{ files: [requestFile] },
					audit(),
				),
			).resolves.toEqual({
				files: [
					{
						canonicalMimeType: "application/x-stored",
						path: browserFile.path,
						status: "reused",
					},
				],
			});
			const [relationCount] = await client.db
				.select({ value: count() })
				.from(versionFiles)
				.where(eq(versionFiles.versionId, draft.id));
			expect(Number(relationCount?.value ?? 0)).toBe(1);

			await expect(
				createVersionsRepository(client.db).finalize({
					audit: audit(),
					expectedRowVersion: draft.rowVersion,
					id: draft.id,
					now: new Date(),
					programId: program.id,
				}),
			).resolves.toMatchObject({
				associatedFileCount: 1,
				lifecycleStatus: "finalized",
			});
		});

		it("never mutates finalized membership and keeps race outcomes atomic", async () => {
			const program = await insertProgram(`Race ${randomUUID()}`);
			const draft = await insertVersion(program.id, 1, "draft", 1);
			const draftRepository = createDraftVersionFilesRepository(client.db);
			const versionsRepository = createVersionsRepository(client.db);
			const first = upload();
			await draftRepository.complete({
				audit: audit(),
				files: [first],
				programId: program.id,
				versionId: draft.id,
			});
			const late = upload();
			await Promise.allSettled([
				versionsRepository.finalize({
					audit: audit(),
					expectedRowVersion: draft.rowVersion,
					id: draft.id,
					now: new Date(),
					programId: program.id,
				}),
				draftRepository.complete({
					audit: audit(),
					files: [late],
					programId: program.id,
					versionId: draft.id,
				}),
			]);
			const [storedVersion] = await client.db
				.select({ lifecycleStatus: applicationVersions.lifecycleStatus })
				.from(applicationVersions)
				.where(eq(applicationVersions.id, draft.id));
			const [relationCount] = await client.db
				.select({ value: count() })
				.from(versionFiles)
				.where(eq(versionFiles.versionId, draft.id));
			const total = Number(relationCount?.value ?? 0);
			if (storedVersion?.lifecycleStatus === "finalized") {
				expect(total).toBe(1);
				await expect(
					draftRepository.complete({
						audit: audit(),
						files: [late],
						programId: program.id,
						versionId: draft.id,
					}),
				).rejects.toBeInstanceOf(DraftVersionFinalizedRepositoryError);
			} else {
				expect(total).toBe(2);
			}
		});

		it("paginates by canonical path and writes summary-only audits", async () => {
			const program = await insertProgram(`Page ${randomUUID()}`);
			const draft = await insertVersion(program.id, 1, "draft", 2);
			const repository = createDraftVersionFilesRepository(client.db);
			const first = upload(`a-${randomUUID()}.bin`);
			const second = upload(`b-${randomUUID()}.bin`);
			const requestId = `req_${randomUUID()}`;
			await repository.complete({
				audit: audit(requestId),
				files: [second, first],
				programId: program.id,
				versionId: draft.id,
			});
			const page = await repository.listVersionFiles({
				limit: 1,
				programId: program.id,
				versionId: draft.id,
			});
			expect(page.hasMore).toBe(true);
			expect(page.items.map(({ path }) => path)).toEqual([first.path]);
			const next = await repository.listVersionFiles({
				afterPath: first.path,
				limit: 1,
				programId: program.id,
				versionId: draft.id,
			});
			expect(next.items.map(({ path }) => path)).toEqual([second.path]);
			expect(next.items[0]).not.toHaveProperty("objectKey");

			const [event] = await client.db
				.select({ after: auditEvents.afterJson })
				.from(auditEvents)
				.where(eq(auditEvents.requestId, requestId));
			expect(event?.after).toEqual({
				alreadyAssociatedCount: 0,
				newlyAssociatedCount: 2,
				requestedCount: 2,
				totalAssociatedCount: 2,
			});
			const serialized = JSON.stringify(event?.after);
			expect(serialized).not.toContain(first.path);
			expect(serialized).not.toContain("objectKey");
		});
	});
}
