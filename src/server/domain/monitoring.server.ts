import process from "node:process";
import type { AuditEventListItemDto } from "../../shared/api/audit";
import type { FieldError } from "../../shared/api/common";
import { isWellFormedUnicode } from "../../shared/api/common";
import {
	type MonitoringApplicationDto,
	type MonitoringMetricsDto,
	type MonitoringStatusDto,
	RELEASE_SERIES_WINDOWS,
	type ReadinessCheckDto,
	type ReleaseSeriesSearch,
	type TimeSeries,
} from "../../shared/api/monitoring";
import {
	createMonitoringRepository,
	type MonitoringMetricsRecord,
	type MonitoringRepository,
} from "../db/repositories/monitoring.server";
import {
	createUploadStsService,
	type UploadStsService,
} from "../integrations/oss/sts.server";
import { type AuditService, createAuditService } from "./audit.server";

const READINESS_CACHE_TTL_MS = 30_000;
const MONITORING_OPERATION_TIMEOUT_MS = 5_000;
const RECENT_OPERATION_LIMIT = 8;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export class MonitoringValidationError extends Error {
	readonly fieldErrors: readonly FieldError[];

	constructor(fieldErrors: readonly FieldError[]) {
		super("Monitoring query is invalid.");
		this.name = "MonitoringValidationError";
		this.fieldErrors = fieldErrors;
	}
}

export interface MonitoringService {
	getReleaseSeries(search: ReleaseSeriesSearch): Promise<TimeSeries>;
	getStatus(): Promise<MonitoringStatusDto>;
}

export interface MonitoringServiceDependencies {
	readonly application?: MonitoringApplicationDto;
	readonly auditService?: AuditService;
	readonly cacheTtlMs?: number;
	readonly environment?: Readonly<Record<string, string | undefined>>;
	readonly getAuditService?: () => AuditService;
	readonly getRepository?: () => MonitoringRepository;
	readonly getUploadStsService?: () => UploadStsService;
	readonly monotonicNow?: () => number;
	readonly neonProbe?: () => Promise<void>;
	readonly now?: () => Date;
	readonly operationTimeoutMs?: number;
	readonly ossStsProbe?: () => Promise<void>;
	readonly repository?: MonitoringRepository;
	readonly uploadStsService?: UploadStsService;
}

interface CachedOperationEntry<Value> {
	readonly expiresAt: number;
	readonly value: BoundedOperationResult<Value>;
}

interface BoundedOperationResult<Value> {
	readonly checkedAt: Date;
	readonly latencyMs: number;
	readonly status: "degraded" | "ready";
	readonly value?: Value;
}

function containsControlCharacter(value: string): boolean {
	for (const character of value) {
		const codePoint = character.codePointAt(0) ?? 0;
		if (codePoint < 32 || codePoint === 127) return true;
	}
	return false;
}

function safeMetadataValue(
	value: string | undefined,
	maximumLength: number,
): string | null {
	if (!value || !isWellFormedUnicode(value) || value.includes("\0"))
		return null;
	const normalized = value.trim();
	if (!normalized || containsControlCharacter(normalized)) return null;
	return [...normalized].slice(0, maximumLength).join("");
}

function applicationMetadata(
	environment: Readonly<Record<string, string | undefined>>,
): MonitoringApplicationDto {
	return {
		buildId: safeMetadataValue(environment.DEPLOY_ID, 128),
		commitRef: safeMetadataValue(environment.COMMIT_REF, 128),
		environment: safeMetadataValue(
			environment.CONTEXT ?? environment.NODE_ENV,
			64,
		),
		name: "updater-admin",
		version: safeMetadataValue(environment.APP_VERSION, 64),
	};
}

function checkedCacheTtl(value: number | undefined): number {
	const ttl = value ?? READINESS_CACHE_TTL_MS;
	if (!Number.isSafeInteger(ttl) || ttl < 0 || ttl > 300_000) {
		throw new RangeError("Monitoring readiness cache TTL is invalid.");
	}
	return ttl;
}

function checkedOperationTimeout(value: number | undefined): number {
	const timeout = value ?? MONITORING_OPERATION_TIMEOUT_MS;
	if (!Number.isSafeInteger(timeout) || timeout < 1 || timeout > 60_000) {
		throw new RangeError("Monitoring operation timeout is invalid.");
	}
	return timeout;
}

function createBoundedCachedOperation<Value>(
	operation: () => Promise<Value>,
	dependencies: {
		readonly cacheTtlMs: number;
		readonly monotonicNow: () => number;
		readonly now: () => Date;
		readonly operationTimeoutMs: number;
	},
) {
	let cache: CachedOperationEntry<Value> | undefined;
	let active:
		| { readonly result: Promise<BoundedOperationResult<Value>> }
		| undefined;

	return async (): Promise<BoundedOperationResult<Value>> => {
		const currentTime = dependencies.now().getTime();
		if (cache && currentTime < cache.expiresAt) return cache.value;
		if (active) return active.result;

		const started = dependencies.monotonicNow();
		let publish: (value: BoundedOperationResult<Value>) => void = () => {};
		let published = false;
		const result = new Promise<BoundedOperationResult<Value>>((resolve) => {
			publish = (value) => {
				cache = {
					expiresAt: value.checkedAt.getTime() + dependencies.cacheTtlMs,
					value,
				};
				if (!published) {
					published = true;
					resolve(value);
				}
			};
		});
		const currentActive = { result };
		active = currentActive;
		const outcome = (
			status: BoundedOperationResult<Value>["status"],
			value?: Value,
		): BoundedOperationResult<Value> => {
			const checkedAt = dependencies.now();
			const elapsed = dependencies.monotonicNow() - started;
			return {
				checkedAt,
				latencyMs: Math.max(
					0,
					Math.round(Number.isFinite(elapsed) ? elapsed : 0),
				),
				status,
				...(value === undefined ? {} : { value }),
			};
		};
		const timeout = setTimeout(() => {
			publish(outcome("degraded"));
			// Drizzle and the Aliyun STS client do not expose AbortSignal support.
			// Keep the timed-out operation as the owner so later polls cannot spawn
			// duplicate hung calls; its eventual settlement refreshes the cache.
		}, dependencies.operationTimeoutMs);

		Promise.resolve()
			.then(operation)
			.then(
				(value) => {
					clearTimeout(timeout);
					publish(outcome("ready", value));
					if (active === currentActive) active = undefined;
				},
				() => {
					clearTimeout(timeout);
					publish(outcome("degraded"));
					if (active === currentActive) active = undefined;
				},
			);

		return result;
	};
}

function readinessDto(result: BoundedOperationResult<void>): ReadinessCheckDto {
	return {
		checkedAt: result.checkedAt.toISOString(),
		latencyMs: result.latencyMs,
		status: result.status,
	};
}

function unavailableMetrics(): MonitoringMetricsDto {
	return {
		activeVersions: null,
		files: null,
		programs: null,
		status: "degraded",
		totalBytes: null,
		versions: null,
	};
}

function metricsDto(record: MonitoringMetricsRecord): MonitoringMetricsDto {
	return {
		activeVersions: record.activeVersions,
		files: record.files,
		programs: record.programs,
		status: "ready",
		totalBytes: record.totalBytes.toString(),
		versions: record.versions,
	};
}

function startOfUtcDay(value: Date): Date {
	return new Date(
		Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()),
	);
}

function addUtcDays(value: Date, days: number): Date {
	const result = new Date(value);
	result.setUTCDate(result.getUTCDate() + days);
	return result;
}

function dateOnly(value: Date): string {
	return value.toISOString().slice(0, 10);
}

function validateWindow(search: ReleaseSeriesSearch): void {
	if (!RELEASE_SERIES_WINDOWS.includes(search.days)) {
		throw new MonitoringValidationError([
			{ code: "INVALID_VALUE", path: "days" },
		]);
	}
}

function validBucket(bucket: string): boolean {
	if (!DATE_PATTERN.test(bucket)) return false;
	const date = new Date(`${bucket}T00:00:00.000Z`);
	return Number.isFinite(date.getTime()) && dateOnly(date) === bucket;
}

export function createMonitoringService(
	dependencies: MonitoringServiceDependencies = {},
): MonitoringService {
	let repository = dependencies.repository;
	let auditService = dependencies.auditService;
	let uploadStsService = dependencies.uploadStsService;
	const resolveRepository = () => {
		repository ??=
			dependencies.getRepository?.() ?? createMonitoringRepository();
		return repository;
	};
	const resolveAuditService = () => {
		auditService ??= dependencies.getAuditService?.() ?? createAuditService();
		return auditService;
	};
	const resolveUploadStsService = () => {
		uploadStsService ??=
			dependencies.getUploadStsService?.() ?? createUploadStsService();
		return uploadStsService;
	};
	const now = dependencies.now ?? (() => new Date());
	const monotonicNow = dependencies.monotonicNow ?? (() => performance.now());
	const cacheTtlMs = checkedCacheTtl(dependencies.cacheTtlMs);
	const operationTimeoutMs = checkedOperationTimeout(
		dependencies.operationTimeoutMs,
	);
	const checkDependencies = {
		cacheTtlMs,
		monotonicNow,
		now,
		operationTimeoutMs,
	};
	const checkNeon = createBoundedCachedOperation(
		dependencies.neonProbe ?? (() => resolveRepository().checkNeon()),
		checkDependencies,
	);
	const checkOssSts = createBoundedCachedOperation(
		dependencies.ossStsProbe ??
			(async () => {
				await resolveUploadStsService().issueUploadCredentials();
			}),
		checkDependencies,
	);
	const loadMetrics = createBoundedCachedOperation(
		() => resolveRepository().getMetrics(),
		checkDependencies,
	);
	const loadRecentOperations = createBoundedCachedOperation(
		() =>
			resolveAuditService().list({
				page: 1,
				pageSize: 20,
				sort: "createdAt:desc",
			}),
		checkDependencies,
	);
	const application =
		dependencies.application ??
		applicationMetadata(dependencies.environment ?? process.env);

	return {
		async getReleaseSeries(search) {
			validateWindow(search);
			const to = startOfUtcDay(now());
			const from = addUtcDays(to, -(search.days - 1));
			const toExclusive = addUtcDays(to, 1);
			const rows = await resolveRepository().getReleaseCounts({
				from,
				toExclusive,
			});
			const counts = new Map<string, number>();
			for (const row of rows) {
				if (
					!validBucket(row.bucket) ||
					!Number.isSafeInteger(row.value) ||
					row.value < 0 ||
					row.bucket < dateOnly(from) ||
					row.bucket > dateOnly(to)
				) {
					throw new Error("Release series repository invariant was violated.");
				}
				counts.set(row.bucket, (counts.get(row.bucket) ?? 0) + row.value);
			}
			const points = Array.from({ length: search.days }, (_, index) => {
				const bucket = dateOnly(addUtcDays(from, index));
				return { bucket, value: counts.get(bucket) ?? 0 };
			});
			return {
				from: dateOnly(from),
				interval: "day",
				points,
				to: dateOnly(to),
				total: points.reduce((total, point) => total + point.value, 0),
			};
		},
		async getStatus() {
			const [neonResult, ossStsResult, metricsResult, operationsResult] =
				await Promise.all([
					checkNeon(),
					checkOssSts(),
					loadMetrics(),
					loadRecentOperations(),
				]);
			const neon = readinessDto(neonResult);
			const ossSts = readinessDto(ossStsResult);
			const metrics =
				metricsResult.status === "ready" && metricsResult.value
					? metricsDto(metricsResult.value)
					: unavailableMetrics();
			const recentItems: readonly AuditEventListItemDto[] =
				operationsResult.status === "ready" && operationsResult.value
					? operationsResult.value.items.slice(0, RECENT_OPERATION_LIMIT)
					: [];
			const operationsStatus = operationsResult.status;
			const status = [
				neon.status,
				ossSts.status,
				metrics.status,
				operationsStatus,
			].every((value) => value === "ready")
				? "ready"
				: "degraded";

			return {
				application,
				checkedAt: now().toISOString(),
				dependencies: { neon, ossSts },
				metrics,
				recentOperations: {
					items: recentItems,
					status: operationsStatus,
				},
				status,
			};
		},
	};
}
