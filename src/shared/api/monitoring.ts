import type { AuditEventListItemDto } from "./audit";

export const RELEASE_SERIES_WINDOWS = [7, 30, 90] as const;

export type ReleaseSeriesWindow = (typeof RELEASE_SERIES_WINDOWS)[number];
export type ReadinessStatus = "degraded" | "ready";

export interface TimeSeriesPoint {
	/** UTC calendar date in YYYY-MM-DD form. */
	readonly bucket: string;
	readonly value: number;
}

/** Renderer-neutral daily series suitable for SVG or a future chart vendor. */
export interface TimeSeries {
	readonly from: string;
	readonly interval: "day";
	readonly points: readonly TimeSeriesPoint[];
	readonly to: string;
	readonly total: number;
}

export interface ReleaseSeriesSearch {
	readonly days: ReleaseSeriesWindow;
}

export interface ReadinessCheckDto {
	readonly checkedAt: string;
	readonly latencyMs: number;
	readonly status: ReadinessStatus;
}

export interface MonitoringApplicationDto {
	readonly buildId: string | null;
	readonly commitRef: string | null;
	readonly environment: string | null;
	readonly name: "updater-admin";
	readonly version: string | null;
}

export interface MonitoringMetricsDto {
	readonly activeVersions: number | null;
	readonly files: number | null;
	readonly programs: number | null;
	readonly status: ReadinessStatus;
	/** Decimal bytes, or null when Neon metrics are unavailable. */
	readonly totalBytes: string | null;
	readonly versions: number | null;
}

export interface RecentOperationsDto {
	readonly items: readonly AuditEventListItemDto[];
	readonly status: ReadinessStatus;
}

export interface MonitoringStatusDto {
	readonly application: MonitoringApplicationDto;
	readonly checkedAt: string;
	readonly dependencies: {
		readonly neon: ReadinessCheckDto;
		readonly ossSts: ReadinessCheckDto;
	};
	readonly metrics: MonitoringMetricsDto;
	readonly recentOperations: RecentOperationsDto;
	readonly status: ReadinessStatus;
}
