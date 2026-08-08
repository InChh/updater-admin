import { DrizzleQueryError } from "drizzle-orm/errors";
import { describe, expect, it, vi } from "vitest";

import { auditEvents } from "../schema";
import { applications, applicationVersions } from "../schema/business";
import {
	createProgramsRepository,
	escapeLikeLiteral,
	isLiveProgramNameUniqueViolation,
	ProgramNameConflictRepositoryError,
	type ProgramRecord,
	ProgramStaleWriteRepositoryError,
} from "./programs.server";

const PROGRAM_ID = "00000000-0000-4000-8000-000000000010";
const ACTOR_ID = "00000000-0000-4000-8000-000000000001";
const NOW = new Date("2026-07-15T01:00:00.000Z");
const audit = {
	actorId: ACTOR_ID,
	ip: "203.0.113.8",
	requestId: "req_test",
	userAgent: "test",
} as const;

function program(overrides: Partial<ProgramRecord> = {}): ProgramRecord {
	return {
		createdAt: new Date("2026-07-14T01:00:00.000Z"),
		createdBy: ACTOR_ID,
		description: "Desktop",
		id: PROGRAM_ID,
		name: "Desktop",
		rowVersion: 3n,
		updatedAt: new Date("2026-07-14T02:00:00.000Z"),
		updatedBy: ACTOR_ID,
		...overrides,
	};
}

interface HarnessOptions {
	readonly applicationInsertError?: unknown;
	readonly applicationInsertResults?: readonly (readonly unknown[])[];
	readonly selectResults?: readonly (readonly unknown[])[];
	readonly updateResults?: readonly (readonly unknown[])[];
}

function createDatabaseHarness(options: HarnessOptions = {}) {
	const selectResults = [...(options.selectResults ?? [])];
	const applicationInsertResults = [
		...(options.applicationInsertResults ?? []),
	];
	const updateResults = [...(options.updateResults ?? [])];
	const inserted: { table: unknown; values: unknown }[] = [];
	const updated: { table: unknown; values: unknown }[] = [];
	const locks: string[] = [];
	const orderings: unknown[][] = [];

	const query = (result: readonly unknown[]) => {
		const resolved = Promise.resolve(result);
		const builder = {
			for: vi.fn((mode: string) => {
				locks.push(mode);
				return resolved;
			}),
			from: vi.fn(() => builder),
			groupBy: vi.fn(() => builder),
			leftJoin: vi.fn(() => builder),
			limit: vi.fn(() => builder),
			offset: vi.fn(() => resolved),
			orderBy: vi.fn((...values: unknown[]) => {
				orderings.push(values);
				return builder;
			}),
			// biome-ignore lint/suspicious/noThenProperty: Drizzle query builders are intentionally thenable.
			then: resolved.then.bind(resolved),
			where: vi.fn(() => builder),
		};
		return builder;
	};

	const select = vi.fn(() => query(selectResults.shift() ?? []));
	const insert = vi.fn((table: unknown) => ({
		values: (values: unknown) => {
			inserted.push({ table, values });
			return {
				returning: async () => {
					if (table === applications && options.applicationInsertError) {
						throw options.applicationInsertError;
					}
					if (table === applications) {
						return applicationInsertResults.shift() ?? [];
					}
					if (table === auditEvents) {
						return [
							{
								createdAt: NOW,
								id: "00000000-0000-4000-8000-000000000099",
							},
						];
					}
					return [];
				},
			};
		},
	}));
	const update = vi.fn((table: unknown) => ({
		set: (values: unknown) => {
			updated.push({ table, values });
			return {
				where: () => ({
					returning: async () => updateResults.shift() ?? [],
				}),
			};
		},
	}));
	const transaction = vi.fn(
		async (operation: (transaction: unknown) => Promise<unknown>) =>
			operation({ insert, select, update }),
	);

	return {
		database: { select, transaction },
		inserted,
		locks,
		orderings,
		transaction,
		updated,
	};
}

describe("programs repository", () => {
	it("escapes literal LIKE metacharacters without changing case", () => {
		expect(escapeLikeLiteral("Desk_%\\APP")).toBe("Desk\\_\\%\\\\APP");
	});

	it("maps only the exact live-name PostgreSQL constraint", () => {
		const conflict = Object.assign(new Error("duplicate program name"), {
			code: "23505",
			constraint: "applications_live_name_unique",
		});
		expect(isLiveProgramNameUniqueViolation(conflict)).toBe(true);
		expect(
			isLiveProgramNameUniqueViolation(
				new DrizzleQueryError("insert into applications", [], conflict),
			),
		).toBe(true);

		const cyclic: Record<string, unknown> = {};
		cyclic.cause = cyclic;
		for (const error of [
			{ code: "23505", constraint: "another_constraint" },
			{ code: "23503", constraint: "applications_live_name_unique" },
			new DrizzleQueryError(
				"insert into applications",
				[],
				Object.assign(new Error("unrelated unique violation"), {
					code: "23505",
					constraint: "another_constraint",
				}),
			),
			cyclic,
			new Error("applications_live_name_unique"),
		]) {
			expect(isLiveProgramNameUniqueViolation(error)).toBe(false);
		}
	});

	it("lists live rows with a stable sort and total", async () => {
		const harness = createDatabaseHarness({
			selectResults: [[program()], [{ value: 1 }]],
		});
		const repository = createProgramsRepository(harness.database as never);

		await expect(
			repository.list({
				name: "Desk_%",
				page: 2,
				pageSize: 20,
				sort: "createdAt:asc",
			}),
		).resolves.toEqual({ items: [program()], total: 1 });
		expect(harness.orderings).toHaveLength(1);
		expect(harness.orderings[0]).toHaveLength(2);
	});

	it("reads detail with the repository-provided live version count", async () => {
		const harness = createDatabaseHarness({
			selectResults: [[{ ...program(), versionCount: 7 }]],
		});
		const repository = createProgramsRepository(harness.database as never);

		await expect(repository.findById(PROGRAM_ID)).resolves.toMatchObject({
			id: PROGRAM_ID,
			versionCount: 7,
		});
	});

	it("creates and redacts the success audit in one transaction", async () => {
		const created = program({
			description: "https://oss.example/file?X-Amz-Signature=must-not-persist",
			rowVersion: 1n,
		});
		const harness = createDatabaseHarness({
			applicationInsertResults: [[created]],
		});
		const repository = createProgramsRepository(harness.database as never);

		await expect(
			repository.create({
				audit,
				description: created.description,
				name: created.name,
			}),
		).resolves.toEqual({ ...created, versionCount: 0 });

		expect(harness.transaction).toHaveBeenCalledOnce();
		expect(harness.inserted.map(({ table }) => table)).toEqual([
			applications,
			auditEvents,
		]);
		expect(harness.inserted[1]?.values).toMatchObject({
			action: "program.created",
			afterJson: { description: "[REDACTED]" },
			requestId: "req_test",
			resourceId: PROGRAM_ID,
			result: "success",
		});
	});

	it("maps the exact create constraint and preserves unrelated database errors", async () => {
		const conflict = Object.assign(new Error("duplicate program name"), {
			code: "23505",
			constraint: "applications_live_name_unique",
		});
		const repository = createProgramsRepository(
			createDatabaseHarness({
				applicationInsertError: new DrizzleQueryError(
					"insert into applications",
					[],
					conflict,
				),
			}).database as never,
		);
		await expect(
			repository.create({ audit, description: null, name: "Desktop" }),
		).rejects.toBeInstanceOf(ProgramNameConflictRepositoryError);

		const unrelated = new DrizzleQueryError(
			"insert into applications",
			[],
			Object.assign(new Error("unrelated unique violation"), {
				code: "23505",
				constraint: "other",
			}),
		);
		const unrelatedRepository = createProgramsRepository(
			createDatabaseHarness({ applicationInsertError: unrelated })
				.database as never,
		);
		await expect(
			unrelatedRepository.create({
				audit,
				description: null,
				name: "Desktop",
			}),
		).rejects.toBe(unrelated);
	});

	it("locks, checks rowVersion, increments it, audits, and returns the live version count", async () => {
		const before = program();
		const after = program({ name: "Desktop Next", rowVersion: 4n });
		const harness = createDatabaseHarness({
			selectResults: [[before], [{ value: 5 }]],
			updateResults: [[after]],
		});
		const repository = createProgramsRepository(harness.database as never);

		await expect(
			repository.update({
				audit,
				expectedRowVersion: 3n,
				id: PROGRAM_ID,
				name: "Desktop Next",
				now: NOW,
			}),
		).resolves.toEqual({ ...after, versionCount: 5 });
		expect(harness.locks).toEqual(["update"]);
		expect(harness.updated).toHaveLength(1);
		expect(harness.updated[0]).toMatchObject({
			table: applications,
			values: { name: "Desktop Next", updatedAt: NOW, updatedBy: ACTOR_ID },
		});
		expect(harness.inserted[0]?.values).toMatchObject({
			action: "program.updated",
			afterJson: { name: "Desktop Next", rowVersion: "4" },
			beforeJson: { name: "Desktop", rowVersion: "3" },
		});
	});

	it("rejects a stale locked row before any update or audit", async () => {
		const harness = createDatabaseHarness({ selectResults: [[program()]] });
		const repository = createProgramsRepository(harness.database as never);

		await expect(
			repository.update({
				audit,
				expectedRowVersion: 2n,
				id: PROGRAM_ID,
				name: "Nope",
				now: NOW,
			}),
		).rejects.toBeInstanceOf(ProgramStaleWriteRepositoryError);
		expect(harness.updated).toEqual([]);
		expect(harness.inserted).toEqual([]);
	});

	it("soft-deletes only the program and its live versions while preserving file relations", async () => {
		const before = program();
		const deleted = program({ rowVersion: 4n, updatedAt: NOW });
		const harness = createDatabaseHarness({
			selectResults: [[before]],
			updateResults: [
				[{ id: "00000000-0000-4000-8000-000000000020" }, { id: "v2" }],
				[deleted],
			],
		});
		const repository = createProgramsRepository(harness.database as never);

		await expect(
			repository.delete({
				audit,
				expectedRowVersion: 3n,
				id: PROGRAM_ID,
				now: NOW,
			}),
		).resolves.toEqual({ affectedVersionCount: 2 });
		expect(harness.updated.map(({ table }) => table)).toEqual([
			applicationVersions,
			applications,
		]);
		expect(harness.inserted).toHaveLength(1);
		expect(harness.inserted[0]?.values).toMatchObject({
			action: "program.deleted",
			afterJson: {
				affectedVersionCount: 2,
				deletedAt: NOW.toISOString(),
				deletedBy: ACTOR_ID,
			},
		});
	});
});
