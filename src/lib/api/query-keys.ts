import {
	ADMINISTRATOR_MAX_PAGE,
	ADMINISTRATOR_PAGE_SIZES,
	ADMINISTRATOR_SORTS,
	ADMINISTRATOR_STATUSES,
	type AdministratorListSearch,
	type AdministratorPageSize,
	type AdministratorSort,
	type AdministratorStatus,
} from "../../shared/api/administrators";
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
import type { ReleaseSeriesWindow } from "../../shared/api/monitoring";
import {
	PROGRAM_MAX_PAGE,
	PROGRAM_PAGE_SIZES,
	PROGRAM_SORTS,
	type ProgramListSearch,
	type ProgramPageSize,
	type ProgramSort,
} from "../../shared/api/programs";
import {
	VERSION_MAX_PAGE,
	VERSION_PAGE_SIZES,
	VERSION_SORTS,
	type VersionListSearch,
	type VersionPageSize,
	type VersionSort,
} from "../../shared/api/versions";

export interface NormalizedProgramListSearch {
	readonly name: null | string;
	readonly page: number;
	readonly pageSize: ProgramPageSize;
	readonly sort: ProgramSort;
}

export interface NormalizedAdministratorListSearch {
	readonly page: number;
	readonly pageSize: AdministratorPageSize;
	readonly query: null | string;
	readonly sort: AdministratorSort;
	readonly status: AdministratorStatus | null;
}

export interface NormalizedVersionListSearch {
	readonly page: number;
	readonly pageSize: VersionPageSize;
	readonly sort: VersionSort;
}

export interface NormalizedAuditListSearch {
	readonly action: AuditAction | null;
	readonly actorId: string | null;
	readonly from: string | null;
	readonly page: number;
	readonly pageSize: AuditPageSize;
	readonly resourceType: AuditResourceType | null;
	readonly result: AuditResult | null;
	readonly sort: AuditSort;
	readonly to: string | null;
}

function isProgramPageSize(value: unknown): value is ProgramPageSize {
	return PROGRAM_PAGE_SIZES.some((pageSize) => pageSize === value);
}

function isAdministratorPageSize(
	value: unknown,
): value is AdministratorPageSize {
	return ADMINISTRATOR_PAGE_SIZES.some((pageSize) => pageSize === value);
}

function isAdministratorSort(value: unknown): value is AdministratorSort {
	return ADMINISTRATOR_SORTS.some((sort) => sort === value);
}

function isAdministratorStatus(value: unknown): value is AdministratorStatus {
	return ADMINISTRATOR_STATUSES.some((status) => status === value);
}

export function normalizeAdministratorListSearch(
	search: AdministratorListSearch,
): NormalizedAdministratorListSearch {
	const trimmedQuery =
		typeof search.query === "string" ? search.query.trim() : "";
	return {
		page:
			Number.isSafeInteger(search.page) &&
			search.page >= 1 &&
			search.page <= ADMINISTRATOR_MAX_PAGE
				? search.page
				: 1,
		pageSize: isAdministratorPageSize(search.pageSize) ? search.pageSize : 20,
		query: trimmedQuery || null,
		sort: isAdministratorSort(search.sort) ? search.sort : "createdAt:desc",
		status: isAdministratorStatus(search.status) ? search.status : null,
	};
}

function isProgramSort(value: unknown): value is ProgramSort {
	return PROGRAM_SORTS.some((sort) => sort === value);
}

export function normalizeProgramListSearch(
	search: ProgramListSearch,
): NormalizedProgramListSearch {
	const trimmedName = typeof search.name === "string" ? search.name.trim() : "";
	return {
		name: trimmedName || null,
		page:
			Number.isSafeInteger(search.page) &&
			search.page >= 1 &&
			search.page <= PROGRAM_MAX_PAGE
				? search.page
				: 1,
		pageSize: isProgramPageSize(search.pageSize) ? search.pageSize : 20,
		sort: isProgramSort(search.sort) ? search.sort : "createdAt:desc",
	};
}

function isVersionPageSize(value: unknown): value is VersionPageSize {
	return VERSION_PAGE_SIZES.some((pageSize) => pageSize === value);
}

function isVersionSort(value: unknown): value is VersionSort {
	return VERSION_SORTS.some((sort) => sort === value);
}

export function normalizeVersionListSearch(
	search: VersionListSearch,
): NormalizedVersionListSearch {
	return {
		page:
			Number.isSafeInteger(search.page) &&
			search.page >= 1 &&
			search.page <= VERSION_MAX_PAGE
				? search.page
				: 1,
		pageSize: isVersionPageSize(search.pageSize) ? search.pageSize : 20,
		sort: isVersionSort(search.sort) ? search.sort : "createdAt:desc",
	};
}

function isAuditAction(value: unknown): value is AuditAction {
	return AUDIT_ACTIONS.some((action) => action === value);
}

function isAuditPageSize(value: unknown): value is AuditPageSize {
	return AUDIT_PAGE_SIZES.some((pageSize) => pageSize === value);
}

function isAuditResourceType(value: unknown): value is AuditResourceType {
	return AUDIT_RESOURCE_TYPES.some((resourceType) => resourceType === value);
}

function isAuditResult(value: unknown): value is AuditResult {
	return AUDIT_RESULTS.some((result) => result === value);
}

function isAuditSort(value: unknown): value is AuditSort {
	return AUDIT_SORTS.some((sort) => sort === value);
}

export function normalizeAuditListSearch(
	search: AuditListSearch,
): NormalizedAuditListSearch {
	return {
		action: isAuditAction(search.action) ? search.action : null,
		actorId:
			typeof search.actorId === "string" && search.actorId.length > 0
				? search.actorId
				: null,
		from: typeof search.from === "string" && search.from ? search.from : null,
		page:
			Number.isSafeInteger(search.page) &&
			search.page >= 1 &&
			search.page <= AUDIT_MAX_PAGE
				? search.page
				: 1,
		pageSize: isAuditPageSize(search.pageSize) ? search.pageSize : 20,
		resourceType: isAuditResourceType(search.resourceType)
			? search.resourceType
			: null,
		result: isAuditResult(search.result) ? search.result : null,
		sort: isAuditSort(search.sort) ? search.sort : "createdAt:desc",
		to: typeof search.to === "string" && search.to ? search.to : null,
	};
}

const allProgramsKey = ["programs"] as const;

const allAdministratorsKey = ["administrators"] as const;

export const administratorQueryKeys = {
	all: allAdministratorsKey,
	list: (search: AdministratorListSearch) =>
		[
			...allAdministratorsKey,
			"list",
			normalizeAdministratorListSearch(search),
		] as const,
	lists: () => [...allAdministratorsKey, "list"] as const,
} as const;

const profileKey = ["profile"] as const;

export const profileQueryKeys = {
	all: profileKey,
	detail: () => [...profileKey, "detail"] as const,
} as const;

const systemSettingsKey = ["settings", "system"] as const;

export const systemSettingsQueryKeys = {
	all: systemSettingsKey,
	detail: () => [...systemSettingsKey, "detail"] as const,
} as const;

export const programQueryKeys = {
	all: allProgramsKey,
	detail: (programId: string) =>
		[...allProgramsKey, "detail", programId] as const,
	details: () => [...allProgramsKey, "detail"] as const,
	list: (search: ProgramListSearch) =>
		[...allProgramsKey, "list", normalizeProgramListSearch(search)] as const,
	lists: () => [...allProgramsKey, "list"] as const,
} as const;

const allVersionsKey = ["versions"] as const;

export const versionQueryKeys = {
	all: allVersionsKey,
	byProgram: (programId: string) =>
		[...allVersionsKey, "program", programId] as const,
	detail: (programId: string, versionId: string) =>
		[...allVersionsKey, "program", programId, "detail", versionId] as const,
	details: (programId: string) =>
		[...allVersionsKey, "program", programId, "detail"] as const,
	list: (programId: string, search: VersionListSearch) =>
		[
			...allVersionsKey,
			"program",
			programId,
			"list",
			normalizeVersionListSearch(search),
		] as const,
	lists: (programId: string) =>
		[...allVersionsKey, "program", programId, "list"] as const,
} as const;

const monitoringKey = ["monitoring"] as const;

export const monitoringQueryKeys = {
	all: monitoringKey,
	releaseSeries: (days: ReleaseSeriesWindow) =>
		[...monitoringKey, "release-series", days] as const,
	status: () => [...monitoringKey, "status"] as const,
} as const;

const auditKey = ["audit-events"] as const;

export const auditQueryKeys = {
	all: auditKey,
	detail: (auditEventId: string) =>
		[...auditKey, "detail", auditEventId] as const,
	details: () => [...auditKey, "detail"] as const,
	list: (search: AuditListSearch) =>
		[...auditKey, "list", normalizeAuditListSearch(search)] as const,
	lists: () => [...auditKey, "list"] as const,
} as const;

export const queryKeys = {
	administrators: administratorQueryKeys,
	audit: auditQueryKeys,
	monitoring: monitoringQueryKeys,
	profile: profileQueryKeys,
	programs: programQueryKeys,
	systemSettings: systemSettingsQueryKeys,
	versions: versionQueryKeys,
} as const;
