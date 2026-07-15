import { apiClient } from "../../lib/api/client";
import { normalizeAuditListSearch } from "../../lib/api/query-keys";
import type {
	AuditEventDetailDto,
	AuditEventPage,
	AuditListSearch,
} from "../../shared/api/audit";
import type {
	MonitoringStatusDto,
	ReleaseSeriesWindow,
	TimeSeries,
} from "../../shared/api/monitoring";
import { isCanonicalAuditEventId } from "./search";

export function getMonitoringStatus(
	signal?: AbortSignal,
): Promise<MonitoringStatusDto> {
	return apiClient.json<MonitoringStatusDto>("/api/v1/monitoring/status", {
		signal,
	});
}

export function getReleaseSeries(
	days: ReleaseSeriesWindow,
	signal?: AbortSignal,
): Promise<TimeSeries> {
	return apiClient.json<TimeSeries>(
		`/api/v1/monitoring/release-series?days=${days}`,
		{ signal },
	);
}

export function listAuditEvents(
	search: AuditListSearch,
	signal?: AbortSignal,
): Promise<AuditEventPage> {
	const normalized = normalizeAuditListSearch(search);
	const parameters = new URLSearchParams({
		page: String(normalized.page),
		pageSize: String(normalized.pageSize),
		sort: normalized.sort,
	});
	if (normalized.action) parameters.set("action", normalized.action);
	if (normalized.actorId) parameters.set("actorId", normalized.actorId);
	if (normalized.from) parameters.set("from", normalized.from);
	if (normalized.resourceType) {
		parameters.set("resourceType", normalized.resourceType);
	}
	if (normalized.result) parameters.set("result", normalized.result);
	if (normalized.to) parameters.set("to", normalized.to);
	return apiClient.json<AuditEventPage>(
		`/api/v1/audit-events?${parameters.toString()}`,
		{ signal },
	);
}

export function getAuditEvent(
	auditEventId: string,
	signal?: AbortSignal,
): Promise<AuditEventDetailDto> {
	if (!isCanonicalAuditEventId(auditEventId)) {
		throw new TypeError("Invalid audit event ID.");
	}
	return apiClient.json<AuditEventDetailDto>(
		`/api/v1/audit-events/${auditEventId}`,
		{ signal },
	);
}
