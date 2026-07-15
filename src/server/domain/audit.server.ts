import {
	AUDIT_ACTIONS,
	AUDIT_MAX_PAGE,
	AUDIT_PAGE_SIZES,
	AUDIT_RESOURCE_TYPES,
	AUDIT_RESULTS,
	AUDIT_SORTS,
	type AuditEventDetailDto,
	type AuditEventListItemDto,
	type AuditEventPage,
	type AuditJsonValue,
	type AuditListSearch,
} from "../../shared/api/audit";
import type { FieldError } from "../../shared/api/common";
import {
	type AuditEventRecord,
	type AuditQueryRepository,
	createAuditRepository,
} from "../db/repositories/audit.server";
import { redactSensitiveData } from "../security/redact";

const UUID_PATTERN =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

export class AuditValidationError extends Error {
	readonly fieldErrors: readonly FieldError[];

	constructor(fieldErrors: readonly FieldError[]) {
		super("Audit query is invalid.");
		this.name = "AuditValidationError";
		this.fieldErrors = fieldErrors;
	}
}

export class AuditEventNotFoundError extends Error {
	constructor() {
		super("Audit event was not found.");
		this.name = "AuditEventNotFoundError";
	}
}

export interface AuditService {
	getById(id: string): Promise<AuditEventDetailDto>;
	list(search: AuditListSearch): Promise<AuditEventPage>;
}

export interface AuditServiceDependencies {
	readonly getRepository?: () => AuditQueryRepository;
	readonly repository?: AuditQueryRepository;
}

function parseUtcDate(value: unknown, path: "from" | "to"): Date | undefined {
	if (value === undefined) return undefined;
	if (typeof value !== "string") {
		throw new AuditValidationError([{ code: "INVALID_VALUE", path }]);
	}
	const match = DATE_PATTERN.exec(value);
	if (!match) {
		throw new AuditValidationError([{ code: "INVALID_FORMAT", path }]);
	}
	const year = Number(match[1]);
	const month = Number(match[2]);
	const day = Number(match[3]);
	const date = new Date(Date.UTC(year, month - 1, day));
	if (date.toISOString().slice(0, 10) !== value) {
		throw new AuditValidationError([{ code: "INVALID_DATE", path }]);
	}
	return date;
}

function addUtcDays(value: Date, days: number): Date {
	const result = new Date(value);
	result.setUTCDate(result.getUTCDate() + days);
	return result;
}

function normalizeSearch(search: AuditListSearch) {
	const errors: FieldError[] = [];
	if (
		!Number.isSafeInteger(search.page) ||
		search.page < 1 ||
		search.page > AUDIT_MAX_PAGE
	) {
		errors.push({ code: "INVALID_VALUE", path: "page" });
	}
	if (!AUDIT_PAGE_SIZES.includes(search.pageSize)) {
		errors.push({ code: "INVALID_VALUE", path: "pageSize" });
	}
	if (!AUDIT_SORTS.includes(search.sort)) {
		errors.push({ code: "INVALID_VALUE", path: "sort" });
	}
	if (search.actorId !== undefined && !UUID_PATTERN.test(search.actorId)) {
		errors.push({ code: "INVALID_FORMAT", path: "actorId" });
	}
	if (search.action !== undefined && !AUDIT_ACTIONS.includes(search.action)) {
		errors.push({ code: "INVALID_VALUE", path: "action" });
	}
	if (
		search.resourceType !== undefined &&
		!AUDIT_RESOURCE_TYPES.includes(search.resourceType)
	) {
		errors.push({ code: "INVALID_VALUE", path: "resourceType" });
	}
	if (search.result !== undefined && !AUDIT_RESULTS.includes(search.result)) {
		errors.push({ code: "INVALID_VALUE", path: "result" });
	}
	if (errors.length > 0) throw new AuditValidationError(errors);

	const from = parseUtcDate(search.from, "from");
	const to = parseUtcDate(search.to, "to");
	if (from && to && from.getTime() > to.getTime()) {
		throw new AuditValidationError([{ code: "INVALID_RANGE", path: "from" }]);
	}

	return {
		...(search.action === undefined ? {} : { action: search.action }),
		...(search.actorId === undefined ? {} : { actorId: search.actorId }),
		...(from === undefined ? {} : { createdAtFrom: from }),
		...(to === undefined ? {} : { createdAtToExclusive: addUtcDays(to, 1) }),
		page: search.page,
		pageSize: search.pageSize,
		...(search.resourceType === undefined
			? {}
			: { resourceType: search.resourceType }),
		...(search.result === undefined ? {} : { result: search.result }),
		sort: search.sort,
	};
}

function listItem(record: AuditEventRecord): AuditEventListItemDto {
	return {
		action: record.action,
		actorId: record.actorId,
		createdAt: record.createdAt.toISOString(),
		id: record.id,
		resourceId: record.resourceId,
		resourceType: record.resourceType,
		result: record.result,
	};
}

function safeJson(value: AuditJsonValue | null): AuditJsonValue | null {
	return value === null ? null : redactSensitiveData(value);
}

function detail(record: AuditEventRecord): AuditEventDetailDto {
	return {
		...listItem(record),
		after: safeJson(record.after),
		before: safeJson(record.before),
		ip: record.ip,
		requestId: record.requestId,
		userAgent: record.userAgent,
	};
}

export function createAuditService(
	dependencies: AuditServiceDependencies = {},
): AuditService {
	let repository = dependencies.repository;
	const resolveRepository = () => {
		repository ??= dependencies.getRepository?.() ?? createAuditRepository();
		return repository;
	};

	return {
		async getById(id) {
			if (!UUID_PATTERN.test(id)) {
				throw new AuditValidationError([
					{ code: "INVALID_FORMAT", path: "auditEventId" },
				]);
			}
			const record = await resolveRepository().findById(id);
			if (!record) throw new AuditEventNotFoundError();
			return detail(record);
		},
		async list(search) {
			const normalized = normalizeSearch(search);
			const result = await resolveRepository().list(normalized);
			return {
				items: result.items.map(listItem),
				page: search.page,
				pageSize: search.pageSize,
				total: result.total,
			};
		},
	};
}
