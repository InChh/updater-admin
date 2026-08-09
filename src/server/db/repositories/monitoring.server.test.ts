import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it, vi } from "vitest";

import {
	createMonitoringRepository,
	type MonitoringDatabase,
} from "./monitoring.server";

function scalarQuery(rows: readonly Record<string, unknown>[]) {
	return {
		from: vi.fn(() => ({ where: vi.fn(async () => rows) })),
	};
}

describe("monitoring repository", () => {
	it("probes Neon and returns exact counts plus bigint storage", async () => {
		const execute = vi.fn(async () => undefined);
		const select = vi
			.fn()
			.mockReturnValueOnce(scalarQuery([{ value: 2 }]))
			.mockReturnValueOnce(scalarQuery([{ value: 4 }]))
			.mockReturnValueOnce(scalarQuery([{ value: 3 }]))
			.mockReturnValueOnce(
				scalarQuery([{ bytes: "9007199254740993", value: 5 }]),
			);
		const repository = createMonitoringRepository({
			execute,
			select,
		} as unknown as MonitoringDatabase);

		await expect(repository.checkNeon()).resolves.toBeUndefined();
		await expect(repository.getMetrics()).resolves.toEqual({
			activeVersions: 3,
			files: 5,
			programs: 2,
			totalBytes: 9_007_199_254_740_993n,
			versions: 4,
		});
		expect(execute).toHaveBeenCalledOnce();
		expect(select).toHaveBeenCalledTimes(4);
	});

	it("groups live finalized releases by finalization day", async () => {
		const orderBy = vi.fn(async () => [
			{ bucket: "2026-07-14", value: 2 },
			{ bucket: "2026-07-15", value: 1 },
		]);
		const groupBy = vi.fn(() => ({ orderBy }));
		const where = vi.fn((_predicate: SQL) => ({ groupBy }));
		const select = vi.fn(() => ({
			from: vi.fn(() => ({ where })),
		}));
		const repository = createMonitoringRepository({
			execute: vi.fn(),
			select,
		} as unknown as MonitoringDatabase);

		await expect(
			repository.getReleaseCounts({
				from: new Date("2026-07-09T00:00:00.000Z"),
				toExclusive: new Date("2026-07-16T00:00:00.000Z"),
			}),
		).resolves.toEqual([
			{ bucket: "2026-07-14", value: 2 },
			{ bucket: "2026-07-15", value: 1 },
		]);
		expect(where).toHaveBeenCalledOnce();
		const predicate = where.mock.calls[0]?.[0];
		if (!predicate) throw new Error("Expected release-count range predicate.");
		const predicateQuery = new PgDialect().sqlToQuery(predicate);
		expect(predicateQuery.sql).toContain(
			'"application_versions"."finalized_at"',
		);
		expect(predicateQuery.sql).toContain(
			'"application_versions"."lifecycle_status"',
		);
		expect(predicateQuery.sql).toContain('"application_versions"."deleted_at"');
		expect(predicateQuery.params).toContain("finalized");
		expect(groupBy).toHaveBeenCalledOnce();
		expect(orderBy).toHaveBeenCalledOnce();
	});

	it("rejects unsafe numeric coercion instead of rounding totals", async () => {
		const select = vi
			.fn()
			.mockReturnValueOnce(scalarQuery([{ value: 2 }]))
			.mockReturnValueOnce(scalarQuery([{ value: 4 }]))
			.mockReturnValueOnce(
				scalarQuery([{ value: Number.MAX_SAFE_INTEGER + 1 }]),
			)
			.mockReturnValueOnce(scalarQuery([{ bytes: "1", value: 5 }]));
		const repository = createMonitoringRepository({
			execute: vi.fn(),
			select,
		} as unknown as MonitoringDatabase);

		await expect(repository.getMetrics()).rejects.toThrow(
			"Active version count invariant was violated.",
		);
	});
});
