import { and, asc, count, desc, eq, gte, lt } from "drizzle-orm";

import type { AuditJsonValue, AuditResult } from "../../../shared/api/audit";
import {
	type RedactedJsonValue,
	redactSensitiveData,
} from "../../security/redact";
import { type Database, getDatabase } from "../client.server";
import { auditEvents } from "../schema";

export interface AppendAuditEventInput {
	readonly action: string;
	readonly actorId: string | null;
	readonly after?: unknown;
	readonly before?: unknown;
	readonly ip: string | null;
	readonly requestId: string;
	readonly resourceId: string;
	readonly resourceType: string;
	readonly result: AuditResult;
	readonly userAgent: string | null;
}

export interface AppendedAuditEvent {
	readonly createdAt: Date;
	readonly id: string;
}

export interface AuditEventRecord {
	readonly action: string;
	readonly actorId: string | null;
	readonly after: AuditJsonValue | null;
	readonly before: AuditJsonValue | null;
	readonly createdAt: Date;
	readonly id: string;
	readonly ip: string | null;
	readonly requestId: string;
	readonly resourceId: string;
	readonly resourceType: string;
	readonly result: AuditResult;
	readonly userAgent: string | null;
}

export interface ListAuditEventsRepositoryInput {
	readonly action?: string;
	readonly actorId?: string;
	readonly createdAtFrom?: Date;
	readonly createdAtToExclusive?: Date;
	readonly page: number;
	readonly pageSize: number;
	readonly resourceType?: string;
	readonly result?: AuditResult;
	readonly sort: "createdAt:asc" | "createdAt:desc";
}

export interface ListAuditEventsRepositoryResult {
	readonly items: readonly AuditEventRecord[];
	readonly total: number;
}

export interface AuditRepository {
	append(input: AppendAuditEventInput): Promise<AppendedAuditEvent>;
}

export interface AuditQueryRepository extends AuditRepository {
	findById(id: string): Promise<AuditEventRecord | null>;
	list(
		input: ListAuditEventsRepositoryInput,
	): Promise<ListAuditEventsRepositoryResult>;
}

export type AuditInsertDatabase = Pick<Database, "insert">;
export type AuditDatabase = Pick<Database, "insert" | "select">;

const AUDIT_SELECTION = {
	action: auditEvents.action,
	actorId: auditEvents.actorId,
	afterJson: auditEvents.afterJson,
	beforeJson: auditEvents.beforeJson,
	createdAt: auditEvents.createdAt,
	id: auditEvents.id,
	ip: auditEvents.ip,
	requestId: auditEvents.requestId,
	resourceId: auditEvents.resourceId,
	resourceType: auditEvents.resourceType,
	result: auditEvents.result,
	userAgent: auditEvents.userAgent,
} as const;

function optionalRedactedValue(value: unknown): RedactedJsonValue | null {
	return value === undefined ? null : redactSensitiveData(value);
}

function storedJson(value: unknown): AuditJsonValue | null {
	return value === null ? null : redactSensitiveData(value);
}

function toAuditEventRecord(
	row: Omit<AuditEventRecord, "after" | "before" | "result"> & {
		readonly afterJson: unknown;
		readonly beforeJson: unknown;
		readonly result: string;
	},
): AuditEventRecord {
	if (row.result !== "success" && row.result !== "failure") {
		throw new Error("Audit event result invariant was violated.");
	}
	return {
		action: row.action,
		actorId: row.actorId,
		after: storedJson(row.afterJson),
		before: storedJson(row.beforeJson),
		createdAt: row.createdAt,
		id: row.id,
		ip: row.ip,
		requestId: row.requestId,
		resourceId: row.resourceId,
		resourceType: row.resourceType,
		result: row.result,
		userAgent: row.userAgent,
	};
}

export function createAuditRepository(
	database?: AuditDatabase | AuditInsertDatabase,
): AuditQueryRepository {
	const resolveDatabase = () => database ?? getDatabase();
	const resolveQueryDatabase = (): AuditDatabase => {
		const client = resolveDatabase();
		if (!("select" in client)) {
			throw new Error("Audit queries require a selectable database client.");
		}
		return client as AuditDatabase;
	};

	return {
		async append(input) {
			const [inserted] = await resolveDatabase()
				.insert(auditEvents)
				.values({
					action: input.action,
					actorId: input.actorId,
					afterJson: optionalRedactedValue(input.after),
					beforeJson: optionalRedactedValue(input.before),
					ip: input.ip,
					requestId: input.requestId,
					resourceId: input.resourceId,
					resourceType: input.resourceType,
					result: input.result,
					userAgent: input.userAgent,
				})
				.returning({ createdAt: auditEvents.createdAt, id: auditEvents.id });
			if (!inserted) throw new Error("Audit event insert returned no row.");
			return inserted;
		},
		async findById(id) {
			const [row] = await resolveQueryDatabase()
				.select(AUDIT_SELECTION)
				.from(auditEvents)
				.where(eq(auditEvents.id, id))
				.limit(1);
			return row ? toAuditEventRecord(row) : null;
		},
		async list(input) {
			const filters = [];
			if (input.actorId !== undefined) {
				filters.push(eq(auditEvents.actorId, input.actorId));
			}
			if (input.action !== undefined) {
				filters.push(eq(auditEvents.action, input.action));
			}
			if (input.resourceType !== undefined) {
				filters.push(eq(auditEvents.resourceType, input.resourceType));
			}
			if (input.result !== undefined) {
				filters.push(eq(auditEvents.result, input.result));
			}
			if (input.createdAtFrom !== undefined) {
				filters.push(gte(auditEvents.createdAt, input.createdAtFrom));
			}
			if (input.createdAtToExclusive !== undefined) {
				filters.push(lt(auditEvents.createdAt, input.createdAtToExclusive));
			}
			const where = filters.length > 0 ? and(...filters) : undefined;
			const order =
				input.sort === "createdAt:asc"
					? [asc(auditEvents.createdAt), asc(auditEvents.id)]
					: [desc(auditEvents.createdAt), desc(auditEvents.id)];
			const databaseClient = resolveQueryDatabase();
			const [rows, totalRows] = await Promise.all([
				databaseClient
					.select(AUDIT_SELECTION)
					.from(auditEvents)
					.where(where)
					.orderBy(...order)
					.limit(input.pageSize)
					.offset((input.page - 1) * input.pageSize),
				databaseClient
					.select({ value: count() })
					.from(auditEvents)
					.where(where),
			]);
			return {
				items: rows.map(toAuditEventRecord),
				total: Number(totalRows[0]?.value ?? 0),
			};
		},
	};
}
