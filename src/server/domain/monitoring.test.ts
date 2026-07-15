import { describe, expect, it, vi } from "vitest";

import type { AuditEventPage } from "../../shared/api/audit";
import type { ReleaseSeriesSearch } from "../../shared/api/monitoring";
import type { MonitoringRepository } from "../db/repositories/monitoring.server";
import type { AuditService } from "./audit.server";
import {
	createMonitoringService,
	MonitoringValidationError,
} from "./monitoring.server";

const auditPage: AuditEventPage = {
	items: [
		{
			action: "version.created",
			actorId: "00000000-0000-4000-8000-000000000001",
			createdAt: "2026-07-15T01:00:00.000Z",
			id: "00000000-0000-4000-8000-000000000010",
			resourceId: "00000000-0000-4000-8000-000000000020",
			resourceType: "version",
			result: "success",
		},
	],
	page: 1,
	pageSize: 20,
	total: 1,
};

function repository(
	overrides: Partial<MonitoringRepository> = {},
): MonitoringRepository {
	return {
		checkNeon: vi.fn(async () => undefined),
		getMetrics: vi.fn(async () => ({
			activeVersions: 3,
			files: 5,
			programs: 2,
			totalBytes: 9_007_199_254_740_993n,
			versions: 4,
		})),
		getReleaseCounts: vi.fn(async () => []),
		...overrides,
	};
}

function auditService(overrides: Partial<AuditService> = {}): AuditService {
	return {
		getById: vi.fn(async () => {
			throw new Error("not used");
		}),
		list: vi.fn(async () => auditPage),
		...overrides,
	};
}

describe("monitoring service", () => {
	it("returns secret-free status and independently caches readiness probes", async () => {
		const neonProbe = vi.fn(async () => undefined);
		const ossStsProbe = vi.fn(async () => undefined);
		const getMetrics = vi.fn(async () => ({
			activeVersions: 3,
			files: 5,
			programs: 2,
			totalBytes: 9_007_199_254_740_993n,
			versions: 4,
		}));
		const list = vi.fn(async () => auditPage);
		const service = createMonitoringService({
			auditService: auditService({ list }),
			environment: {
				APP_VERSION: "1.2.3",
				COMMIT_REF: "abcdef123456",
				CONTEXT: "deploy-preview",
				DEPLOY_ID: "deploy-42",
				OSS_ACCESS_KEY_SECRET: "must-not-cross",
			},
			neonProbe,
			now: () => new Date("2026-07-15T02:00:00.000Z"),
			ossStsProbe,
			repository: repository({ getMetrics }),
		});

		const first = await service.getStatus();
		const second = await service.getStatus();

		expect(first).toMatchObject({
			application: {
				buildId: "deploy-42",
				commitRef: "abcdef123456",
				environment: "deploy-preview",
				name: "updater-admin",
				version: "1.2.3",
			},
			dependencies: {
				neon: { status: "ready" },
				ossSts: { status: "ready" },
			},
			metrics: {
				activeVersions: 3,
				files: 5,
				programs: 2,
				status: "ready",
				totalBytes: "9007199254740993",
				versions: 4,
			},
			recentOperations: { items: auditPage.items, status: "ready" },
			status: "ready",
		});
		expect(second.dependencies).toEqual(first.dependencies);
		expect(neonProbe).toHaveBeenCalledOnce();
		expect(ossStsProbe).toHaveBeenCalledOnce();
		expect(getMetrics).toHaveBeenCalledOnce();
		expect(list).toHaveBeenCalledOnce();
		expect(JSON.stringify(first)).not.toContain("must-not-cross");
	});

	it("degrades each unavailable section instead of throwing or exposing errors", async () => {
		const leakedMessage = "postgres://admin:password@db and STS secret";
		const service = createMonitoringService({
			auditService: auditService({
				list: async () => {
					throw new Error(leakedMessage);
				},
			}),
			neonProbe: async () => {
				throw new Error(leakedMessage);
			},
			now: () => new Date("2026-07-15T02:00:00.000Z"),
			ossStsProbe: async () => {
				throw new Error(leakedMessage);
			},
			repository: repository({
				getMetrics: async () => {
					throw new Error(leakedMessage);
				},
			}),
		});

		const result = await service.getStatus();
		expect(result).toMatchObject({
			dependencies: {
				neon: { status: "degraded" },
				ossSts: { status: "degraded" },
			},
			metrics: {
				activeVersions: null,
				files: null,
				programs: null,
				status: "degraded",
				totalBytes: null,
				versions: null,
			},
			recentOperations: { items: [], status: "degraded" },
			status: "degraded",
		});
		expect(JSON.stringify(result)).not.toContain(leakedMessage);
		expect(Object.keys(result.dependencies.neon).sort()).toEqual([
			"checkedAt",
			"latencyMs",
			"status",
		]);
	});

	it("bounds and coalesces hung sections without starting duplicate work", async () => {
		vi.useFakeTimers();
		try {
			let wallTime = new Date("2026-07-15T02:00:00.000Z").getTime();
			let monotonicTime = 0;
			let resolveNeon!: () => void;
			let resolveOssSts!: () => void;
			let resolveMetrics!: (value: {
				activeVersions: number;
				files: number;
				programs: number;
				totalBytes: bigint;
				versions: number;
			}) => void;
			let resolveOperations!: (value: AuditEventPage) => void;
			const neonProbe = vi.fn(
				() =>
					new Promise<void>((resolve) => {
						resolveNeon = resolve;
					}),
			);
			const ossStsProbe = vi.fn(
				() =>
					new Promise<void>((resolve) => {
						resolveOssSts = resolve;
					}),
			);
			const getMetrics = vi.fn(
				() =>
					new Promise<{
						activeVersions: number;
						files: number;
						programs: number;
						totalBytes: bigint;
						versions: number;
					}>((resolve) => {
						resolveMetrics = resolve;
					}),
			);
			const list = vi.fn(
				() =>
					new Promise<AuditEventPage>((resolve) => {
						resolveOperations = resolve;
					}),
			);
			const service = createMonitoringService({
				auditService: auditService({ list }),
				cacheTtlMs: 10,
				monotonicNow: () => monotonicTime,
				neonProbe,
				now: () => new Date(wallTime),
				operationTimeoutMs: 25,
				ossStsProbe,
				repository: repository({ getMetrics }),
			});

			const first = service.getStatus();
			const concurrent = service.getStatus();
			await Promise.resolve();
			expect(neonProbe).toHaveBeenCalledOnce();
			expect(ossStsProbe).toHaveBeenCalledOnce();
			expect(getMetrics).toHaveBeenCalledOnce();
			expect(list).toHaveBeenCalledOnce();

			wallTime += 25;
			monotonicTime += 25;
			await vi.advanceTimersByTimeAsync(25);
			const [firstResult, concurrentResult] = await Promise.all([
				first,
				concurrent,
			]);
			expect(firstResult.status).toBe("degraded");
			expect(concurrentResult).toEqual(firstResult);

			wallTime += 11;
			monotonicTime += 11;
			await expect(service.getStatus()).resolves.toMatchObject({
				status: "degraded",
			});
			expect(neonProbe).toHaveBeenCalledOnce();
			expect(ossStsProbe).toHaveBeenCalledOnce();
			expect(getMetrics).toHaveBeenCalledOnce();
			expect(list).toHaveBeenCalledOnce();

			resolveNeon();
			resolveOssSts();
			resolveMetrics({
				activeVersions: 3,
				files: 5,
				programs: 2,
				totalBytes: 42n,
				versions: 4,
			});
			resolveOperations(auditPage);
			await Promise.resolve();
			await Promise.resolve();

			await expect(service.getStatus()).resolves.toMatchObject({
				metrics: { status: "ready" },
				recentOperations: { status: "ready" },
				status: "ready",
			});
			expect(neonProbe).toHaveBeenCalledOnce();
			expect(ossStsProbe).toHaveBeenCalledOnce();
			expect(getMetrics).toHaveBeenCalledOnce();
			expect(list).toHaveBeenCalledOnce();
		} finally {
			vi.useRealTimers();
		}
	});

	it("fills exact UTC day buckets for 7, 30, and 90 day windows", async () => {
		const getReleaseCounts = vi.fn(async () => [
			{ bucket: "2026-07-09", value: 2 },
			{ bucket: "2026-07-12", value: 3 },
			{ bucket: "2026-07-15", value: 1 },
		]);
		const service = createMonitoringService({
			now: () => new Date("2026-07-15T23:59:59.999Z"),
			repository: repository({ getReleaseCounts }),
		});

		const series = await service.getReleaseSeries({ days: 7 });
		expect(series).toEqual({
			from: "2026-07-09",
			interval: "day",
			points: [
				{ bucket: "2026-07-09", value: 2 },
				{ bucket: "2026-07-10", value: 0 },
				{ bucket: "2026-07-11", value: 0 },
				{ bucket: "2026-07-12", value: 3 },
				{ bucket: "2026-07-13", value: 0 },
				{ bucket: "2026-07-14", value: 0 },
				{ bucket: "2026-07-15", value: 1 },
			],
			to: "2026-07-15",
			total: 6,
		});
		expect(getReleaseCounts).toHaveBeenCalledWith({
			from: new Date("2026-07-09T00:00:00.000Z"),
			toExclusive: new Date("2026-07-16T00:00:00.000Z"),
		});

		for (const days of [30, 90] as const) {
			getReleaseCounts.mockResolvedValueOnce([]);
			const result = await service.getReleaseSeries({ days });
			expect(result.points).toHaveLength(days);
			expect(result.points.at(-1)?.bucket).toBe("2026-07-15");
		}
	});

	it("rejects non-whitelisted windows", async () => {
		const getReleaseCounts = vi.fn();
		const service = createMonitoringService({
			repository: repository({ getReleaseCounts }),
		});
		await expect(
			service.getReleaseSeries({ days: 14 } as unknown as ReleaseSeriesSearch),
		).rejects.toBeInstanceOf(MonitoringValidationError);
		expect(getReleaseCounts).not.toHaveBeenCalled();
	});
});
