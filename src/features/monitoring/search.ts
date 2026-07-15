import {
	AUDIT_ACTIONS,
	AUDIT_MAX_PAGE,
	AUDIT_PAGE_SIZES,
	AUDIT_RESOURCE_TYPES,
	AUDIT_RESULTS,
	AUDIT_SORTS,
	type AuditAction,
	type AuditListSearch,
	type AuditPageSize,
	type AuditResourceType,
	type AuditResult,
	type AuditSort,
} from "../../shared/api/audit";
import {
	RELEASE_SERIES_WINDOWS,
	type ReleaseSeriesWindow,
} from "../../shared/api/monitoring";

export interface MonitoringRouteSearch {
	readonly days: ReleaseSeriesWindow;
}

type AuditListLoaderDeps = Omit<AuditListSearch, "pageSize"> & {
	readonly pageSize?: AuditPageSize;
};

export type AuditRouteSearch = AuditListSearch & {
	readonly auditEventId?: string;
};

export type ValidatedAuditRouteSearch = AuditListLoaderDeps & {
	readonly auditEventId?: string;
};

const CANONICAL_UUID_PATTERN =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

function isMember<const Values extends readonly unknown[]>(
	values: Values,
	value: unknown,
): value is Values[number] {
	return values.some((candidate) => candidate === value);
}

function safePage(value: unknown): number {
	const parsed = typeof value === "number" ? value : Number(value);
	return Number.isSafeInteger(parsed) && parsed >= 1 && parsed <= AUDIT_MAX_PAGE
		? parsed
		: 1;
}

function safePageSize(value: unknown): AuditPageSize {
	const parsed = typeof value === "number" ? value : Number(value);
	return isMember(AUDIT_PAGE_SIZES, parsed) ? parsed : 20;
}

function safeDate(value: unknown): string | undefined {
	if (typeof value !== "string") return undefined;
	const match = DATE_PATTERN.exec(value);
	if (!match) return undefined;
	const date = new Date(
		Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])),
	);
	return Number.isFinite(date.getTime()) &&
		date.toISOString().slice(0, 10) === value
		? value
		: undefined;
}

export function isCanonicalAuditEventId(value: unknown): value is string {
	return typeof value === "string" && CANONICAL_UUID_PATTERN.test(value);
}

export function validateMonitoringRouteSearch(
	raw: Record<string, unknown>,
): MonitoringRouteSearch {
	const parsed = typeof raw.days === "number" ? raw.days : Number(raw.days);
	return {
		days: isMember(RELEASE_SERIES_WINDOWS, parsed) ? parsed : 30,
	};
}

export function validateAuditRouteSearch(
	raw: Record<string, unknown>,
): ValidatedAuditRouteSearch {
	const from = safeDate(raw.from);
	const to = safeDate(raw.to);
	const validRange = !from || !to || from <= to;
	const actorId = isCanonicalAuditEventId(raw.actorId)
		? raw.actorId
		: undefined;
	const listSearch: AuditListLoaderDeps = {
		...(isMember(AUDIT_ACTIONS, raw.action)
			? { action: raw.action as AuditAction }
			: {}),
		...(actorId ? { actorId } : {}),
		...(from && validRange ? { from } : {}),
		page: safePage(raw.page),
		...(Object.hasOwn(raw, "pageSize")
			? { pageSize: safePageSize(raw.pageSize) }
			: {}),
		...(isMember(AUDIT_RESOURCE_TYPES, raw.resourceType)
			? { resourceType: raw.resourceType as AuditResourceType }
			: {}),
		...(isMember(AUDIT_RESULTS, raw.result)
			? { result: raw.result as AuditResult }
			: {}),
		sort: isMember(AUDIT_SORTS, raw.sort)
			? (raw.sort as AuditSort)
			: "createdAt:desc",
		...(to && validRange ? { to } : {}),
	};
	return isCanonicalAuditEventId(raw.auditEventId)
		? { ...listSearch, auditEventId: raw.auditEventId }
		: listSearch;
}

export function auditListLoaderDeps(
	search: ValidatedAuditRouteSearch,
): AuditListLoaderDeps {
	return {
		...(search.action ? { action: search.action } : {}),
		...(search.actorId ? { actorId: search.actorId } : {}),
		...(search.from ? { from: search.from } : {}),
		page: search.page,
		...(search.pageSize === undefined ? {} : { pageSize: search.pageSize }),
		...(search.resourceType ? { resourceType: search.resourceType } : {}),
		...(search.result ? { result: search.result } : {}),
		sort: search.sort,
		...(search.to ? { to: search.to } : {}),
	};
}

export function auditListSearch(search: AuditRouteSearch): AuditListSearch {
	return {
		...auditListLoaderDeps(search),
		pageSize: search.pageSize,
	};
}

export function openAuditDetail(
	search: AuditRouteSearch,
	auditEventId: string,
): AuditRouteSearch {
	if (!isCanonicalAuditEventId(auditEventId)) {
		throw new TypeError("Invalid audit event ID.");
	}
	return { ...auditListSearch(search), auditEventId };
}

export function closeAuditDetail(search: AuditRouteSearch): AuditRouteSearch {
	return auditListSearch(search);
}
