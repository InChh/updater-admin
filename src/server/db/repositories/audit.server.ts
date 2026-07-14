import {
	type RedactedJsonValue,
	redactSensitiveData,
} from "../../security/redact";
import type { Database } from "../client.server";
import { auditEvents } from "../schema";

export type AuditResult = "failure" | "success";

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

export interface AuditRepository {
	append(input: AppendAuditEventInput): Promise<AppendedAuditEvent>;
}

export type AuditInsertDatabase = Pick<Database, "insert">;

function optionalRedactedValue(value: unknown): RedactedJsonValue | null {
	return value === undefined ? null : redactSensitiveData(value);
}

export function createAuditRepository(
	database: AuditInsertDatabase,
): AuditRepository {
	return {
		async append(input) {
			const [inserted] = await database
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
	};
}
