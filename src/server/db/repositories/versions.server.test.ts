import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it, vi } from "vitest";

import type { VersionRecord } from "./versions.server";
import {
	compareVersionRepositoryValues,
	createVersionsRepository,
	isLiveVersionNumberUniqueViolation,
	type VersionNotGreaterRepositoryError,
	VersionNumberConflictRepositoryError,
} from "./versions.server";

const PROGRAM_ID = "00000000-0000-4000-8000-000000000010";
const VERSION_1_ID = "00000000-0000-4000-8000-000000000020";
const VERSION_2_ID = "00000000-0000-4000-8000-000000000021";
const ACTOR_ID = "00000000-0000-4000-8000-000000000001";

function version(
	overrides: Partial<Omit<VersionRecord, "isLatest">> = {},
): Omit<VersionRecord, "isLatest"> {
	return {
		associatedFileCount: 0,
		createdAt: new Date("2026-07-14T01:00:00.000Z"),
		createdBy: ACTOR_ID,
		description: "Release",
		expectedFileCount: null,
		fileCount: 0,
		finalizedAt: new Date("2026-07-14T01:00:00.000Z"),
		id: VERSION_1_ID,
		isActive: true,
		lifecycleStatus: "finalized",
		programId: PROGRAM_ID,
		rowVersion: 1n,
		updatedAt: new Date("2026-07-14T01:00:00.000Z"),
		updatedBy: ACTOR_ID,
		versionMajor: 1,
		versionMinor: 0,
		versionNumber: "1.0.0",
		versionPatch: 0,
		...overrides,
	};
}

function createSelectHarness(selectResults: readonly (readonly unknown[])[]) {
	const results = [...selectResults];
	const orderings: unknown[][] = [];
	const predicates: unknown[] = [];
	const insert = vi.fn();
	const select = vi.fn(() => {
		const result = Promise.resolve(results.shift() ?? []);
		const builder = {
			for: vi.fn(() => result),
			from: vi.fn(() => builder),
			limit: vi.fn(() => builder),
			offset: vi.fn(() => result),
			orderBy: vi.fn((...values: unknown[]) => {
				orderings.push(values);
				return builder;
			}),
			// biome-ignore lint/suspicious/noThenProperty: Drizzle query builders are intentionally thenable.
			then: result.then.bind(result),
			where: vi.fn((predicate: unknown) => {
				predicates.push(predicate);
				return builder;
			}),
		};
		return builder;
	});
	const transaction = vi.fn(
		async (operation: (database: unknown) => Promise<unknown>) =>
			operation({ insert, select }),
	);
	return { database: { select, transaction }, insert, orderings, predicates };
}

const audit = {
	actorId: ACTOR_ID,
	ip: null,
	requestId: "req_test",
	userAgent: null,
} as const;

describe("versions repository", () => {
	it("compares numeric components instead of lexicographic version text", () => {
		expect(
			compareVersionRepositoryValues(
				{ versionMajor: 1, versionMinor: 10, versionPatch: 0 },
				{ versionMajor: 1, versionMinor: 9, versionPatch: 99 },
			),
		).toBeGreaterThan(0);
	});

	it("maps only the exact live-number PostgreSQL constraint", () => {
		expect(
			isLiveVersionNumberUniqueViolation({
				code: "23505",
				constraint: "application_versions_live_number_unique",
			}),
		).toBe(true);
		expect(
			isLiveVersionNumberUniqueViolation({
				code: "23505",
				constraint: "another_constraint",
			}),
		).toBe(false);
	});

	it("marks only the highest active finalized row as latest", async () => {
		const first = version();
		const second = version({
			id: VERSION_2_ID,
			versionMinor: 10,
			versionNumber: "1.10.0",
		});
		const draft = version({
			finalizedAt: null,
			id: "00000000-0000-4000-8000-000000000022",
			isActive: false,
			lifecycleStatus: "draft",
			versionMinor: 11,
			versionNumber: "1.11.0",
		});
		const harness = createSelectHarness([
			[{ id: PROGRAM_ID }],
			[first, second, draft],
			[{ value: 3 }],
			[{ id: VERSION_2_ID }],
		]);
		const repository = createVersionsRepository(harness.database as never);

		await expect(
			repository.list({
				page: 1,
				pageSize: 20,
				programId: PROGRAM_ID,
				sort: "createdAt:desc",
			}),
		).resolves.toMatchObject({
			items: [
				{ id: VERSION_1_ID, isLatest: false },
				{ id: VERSION_2_ID, isLatest: true },
				{ id: draft.id, isLatest: false },
			],
			total: 3,
		});
		expect(harness.orderings[1]).toHaveLength(4);
	});

	it("rejects a draft below the highest live finalized version before inserting", async () => {
		const harness = createSelectHarness([
			[{ id: PROGRAM_ID }],
			[],
			[
				{
					versionMajor: 2,
					versionMinor: 0,
					versionNumber: "2.0.0",
					versionPatch: 0,
				},
			],
		]);
		const repository = createVersionsRepository(harness.database as never);

		await expect(
			repository.createDraft({
				audit,
				description: "Regression",
				expectedFileCount: 3,
				programId: PROGRAM_ID,
				versionMajor: 1,
				versionMinor: 9,
				versionNumber: "1.9.9",
				versionPatch: 9,
			}),
		).rejects.toMatchObject({
			currentMax: "2.0.0",
		} satisfies Partial<VersionNotGreaterRepositoryError>);
		expect(harness.insert).not.toHaveBeenCalled();
		const liveMaximumPredicate = new PgDialect().sqlToQuery(
			harness.predicates[2] as Parameters<PgDialect["sqlToQuery"]>[0],
		);
		expect(liveMaximumPredicate.sql).toContain(
			'"application_versions"."lifecycle_status" = $2',
		);
		expect(liveMaximumPredicate.sql).toContain(
			'"application_versions"."deleted_at"',
		);
		expect(liveMaximumPredicate.params).toEqual([PROGRAM_ID, "finalized"]);
	});

	it("classifies a live duplicate before current-version monotonicity", async () => {
		const harness = createSelectHarness([
			[{ id: PROGRAM_ID }],
			[{ id: VERSION_1_ID }],
		]);
		const repository = createVersionsRepository(harness.database as never);

		await expect(
			repository.createDraft({
				audit,
				description: "Duplicate",
				expectedFileCount: 1,
				programId: PROGRAM_ID,
				versionMajor: 1,
				versionMinor: 0,
				versionNumber: "1.0.0",
				versionPatch: 0,
			}),
		).rejects.toBeInstanceOf(VersionNumberConflictRepositoryError);
		expect(harness.insert).not.toHaveBeenCalled();
	});
});
