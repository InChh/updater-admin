import { describe, expect, it, vi } from "vitest";
import { createFilesRepository } from "./files.server";
import { ProgramNotFoundRepositoryError } from "./programs.server";
import { VersionNotFoundRepositoryError } from "./versions.server";

const PROGRAM_ID = "00000000-0000-4000-8000-000000000010";
const VERSION_ID = "00000000-0000-4000-8000-000000000020";
const FILE_ID = "00000000-0000-4000-8000-000000000030";
const ACTOR_ID = "00000000-0000-4000-8000-000000000001";

const file = {
	checksumAlgorithm: "sha256",
	createdAt: new Date("2026-07-14T01:00:00.000Z"),
	createdBy: ACTOR_ID,
	id: FILE_ID,
	mimeType: "application/octet-stream",
	path: "Desktop_%/app.bin",
	rowVersion: 1n,
	sha256: "a".repeat(64),
	size: 42n,
	updatedAt: new Date("2026-07-14T01:00:00.000Z"),
	updatedBy: ACTOR_ID,
} as const;

function createSelectHarness(selectResults: readonly (readonly unknown[])[]) {
	const results = [...selectResults];
	const innerJoins: unknown[][] = [];
	const orderings: unknown[][] = [];
	const select = vi.fn(() => {
		const result = Promise.resolve(results.shift() ?? []);
		const builder = {
			from: vi.fn(() => builder),
			innerJoin: vi.fn((...values: unknown[]) => {
				innerJoins.push(values);
				return builder;
			}),
			limit: vi.fn(() => builder),
			offset: vi.fn(() => result),
			orderBy: vi.fn((...values: unknown[]) => {
				orderings.push(values);
				return builder;
			}),
			// biome-ignore lint/suspicious/noThenProperty: Drizzle query builders are intentionally thenable.
			then: result.then.bind(result),
			where: vi.fn(() => builder),
		};
		return builder;
	});
	return { database: { select }, innerJoins, orderings };
}

describe("files repository", () => {
	it("returns live metadata without exposing the OSS object key", async () => {
		const repository = createFilesRepository(
			createSelectHarness([[file]]).database as never,
		);
		const result = await repository.findById(FILE_ID);

		expect(result).toEqual(file);
		expect(result).not.toHaveProperty("objectKey");
	});

	it("lists a literal path filter with whitelist sort and a stable id tie-breaker", async () => {
		const harness = createSelectHarness([[file], [{ value: 1 }]]);
		const repository = createFilesRepository(harness.database as never);

		await expect(
			repository.list({
				page: 1,
				pageSize: 20,
				path: "_%",
				sort: "path:asc",
			}),
		).resolves.toEqual({ items: [file], total: 1 });
		expect(harness.orderings).toHaveLength(1);
		expect(harness.orderings[0]).toHaveLength(2);
	});

	it("distinguishes a missing program from an empty nested file page", async () => {
		const repository = createFilesRepository(
			createSelectHarness([[]]).database as never,
		);

		await expect(
			repository.listForVersion({
				page: 1,
				pageSize: 20,
				programId: PROGRAM_ID,
				sort: "path:asc",
				versionId: VERSION_ID,
			}),
		).rejects.toBeInstanceOf(ProgramNotFoundRepositoryError);
	});

	it("distinguishes a missing version from an empty nested file page", async () => {
		const repository = createFilesRepository(
			createSelectHarness([[{ id: PROGRAM_ID }], []]).database as never,
		);

		await expect(
			repository.listForVersion({
				page: 1,
				pageSize: 20,
				programId: PROGRAM_ID,
				sort: "path:asc",
				versionId: VERSION_ID,
			}),
		).rejects.toBeInstanceOf(VersionNotFoundRepositoryError);
	});

	it("paginates only live metadata related to an existing version", async () => {
		const harness = createSelectHarness([
			[{ id: PROGRAM_ID }],
			[{ id: VERSION_ID }],
			[file],
			[{ value: 1 }],
		]);
		const repository = createFilesRepository(harness.database as never);

		await expect(
			repository.listForVersion({
				page: 1,
				pageSize: 20,
				programId: PROGRAM_ID,
				sort: "path:desc",
				versionId: VERSION_ID,
			}),
		).resolves.toEqual({ items: [file], total: 1 });
		expect(harness.innerJoins).toHaveLength(2);
		expect(harness.orderings[0]).toHaveLength(2);
	});
});
