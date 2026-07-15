import type { Page } from "./common";

export const AUDIT_ACTIONS = [
	"api.mutation",
	"administrator.created",
	"administrator.password.reset",
	"administrator.sessions.revoked",
	"administrator.updated",
	"profile.password.changed",
	"profile.updated",
	"program.created",
	"program.deleted",
	"program.updated",
	"system-settings.updated",
	"upload.completed",
	"upload.credentials.issued",
	"version.activation.updated",
	"version.created",
	"version.deleted",
	"version.updated",
] as const;

export const AUDIT_RESOURCE_TYPES = [
	"administrator",
	"api",
	"profile",
	"program",
	"system-settings",
	"upload",
	"version",
] as const;

export const AUDIT_RESULTS = ["success", "failure"] as const;
export const AUDIT_SORTS = ["createdAt:desc", "createdAt:asc"] as const;
export const AUDIT_PAGE_SIZES = [20, 50, 100] as const;
export const AUDIT_MAX_PAGE = 1_000_000;

export type AuditAction = (typeof AUDIT_ACTIONS)[number];
export type AuditResourceType = (typeof AUDIT_RESOURCE_TYPES)[number];
export type AuditResult = (typeof AUDIT_RESULTS)[number];
export type AuditSort = (typeof AUDIT_SORTS)[number];
export type AuditPageSize = (typeof AUDIT_PAGE_SIZES)[number];

export type AuditJsonValue =
	| null
	| boolean
	| number
	| string
	| AuditJsonValue[]
	| { [key: string]: AuditJsonValue };

export interface AuditListSearch {
	readonly action?: AuditAction;
	readonly actorId?: string;
	/** Inclusive UTC calendar date in YYYY-MM-DD form. */
	readonly from?: string;
	readonly page: number;
	readonly pageSize: AuditPageSize;
	readonly resourceType?: AuditResourceType;
	readonly result?: AuditResult;
	readonly sort: AuditSort;
	/** Inclusive UTC calendar date in YYYY-MM-DD form. */
	readonly to?: string;
}

export interface AuditEventListItemDto {
	readonly action: string;
	readonly actorId: string | null;
	readonly createdAt: string;
	readonly id: string;
	readonly resourceId: string;
	readonly resourceType: string;
	readonly result: AuditResult;
}

export interface AuditEventDetailDto extends AuditEventListItemDto {
	readonly after: AuditJsonValue | null;
	readonly before: AuditJsonValue | null;
	readonly ip: string | null;
	readonly requestId: string;
	readonly userAgent: string | null;
}

export type AuditEventPage = Omit<Page<AuditEventListItemDto>, "pageSize"> & {
	readonly pageSize: AuditPageSize;
};
