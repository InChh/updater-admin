import { queryOptions } from "@tanstack/solid-query";

import { auditQueryKeys, monitoringQueryKeys } from "../../lib/api/query-keys";
import type { AuditListSearch } from "../../shared/api/audit";
import type { ReleaseSeriesWindow } from "../../shared/api/monitoring";
import {
	getAuditEvent,
	getMonitoringStatus,
	getReleaseSeries,
	listAuditEvents,
} from "./api";

export function monitoringStatusQueryOptions() {
	return queryOptions({
		queryFn: ({ signal }) => getMonitoringStatus(signal),
		queryKey: monitoringQueryKeys.status(),
		refetchInterval: 60_000,
	});
}

export function releaseSeriesQueryOptions(days: ReleaseSeriesWindow) {
	return queryOptions({
		queryFn: ({ signal }) => getReleaseSeries(days, signal),
		queryKey: monitoringQueryKeys.releaseSeries(days),
	});
}

export function auditListQueryOptions(search: AuditListSearch) {
	return queryOptions({
		queryFn: ({ signal }) => listAuditEvents(search, signal),
		queryKey: auditQueryKeys.list(search),
	});
}

export function auditDetailQueryOptions(auditEventId: string) {
	return queryOptions({
		queryFn: ({ signal }) => getAuditEvent(auditEventId, signal),
		queryKey: auditQueryKeys.detail(auditEventId),
	});
}
