import { eq } from "drizzle-orm";

import { type Database, getDatabase } from "../client.server";
import { adminMetadata } from "../schema";
import {
	type AuditInsertDatabase,
	createAuditRepository,
} from "./audit.server";

type DatabaseTransaction = Parameters<
	Parameters<Database["transaction"]>[0]
>[0];

export interface CompletePasswordChangeInput {
	readonly actorId: string;
	readonly ip: string | null;
	readonly previousMustChangePassword: boolean;
	readonly requestId: string;
	readonly userAgent: string | null;
}

export interface BeginPasswordChangeInput {
	readonly actorId: string;
}

export interface ProfileRepository {
	beginPasswordChange(input: BeginPasswordChangeInput): Promise<void>;
	completePasswordChange(input: CompletePasswordChangeInput): Promise<void>;
}

async function beginPasswordChange(
	database: Pick<Database, "update">,
	input: BeginPasswordChangeInput,
): Promise<void> {
	const updated = await database
		.update(adminMetadata)
		.set({ mustChangePassword: true })
		.where(eq(adminMetadata.userId, input.actorId))
		.returning({ userId: adminMetadata.userId });
	if (updated.length !== 1) {
		throw new Error("Administrator metadata was not updated.");
	}
}

async function completePasswordChangeInTransaction(
	transaction: DatabaseTransaction,
	input: CompletePasswordChangeInput,
): Promise<void> {
	const updated = await transaction
		.update(adminMetadata)
		.set({ mustChangePassword: false })
		.where(eq(adminMetadata.userId, input.actorId))
		.returning({ userId: adminMetadata.userId });
	if (updated.length !== 1) {
		throw new Error("Administrator metadata was not updated.");
	}

	await createAuditRepository(transaction as AuditInsertDatabase).append({
		action: "profile.password.changed",
		actorId: input.actorId,
		after: { mustChangePassword: false },
		before: { mustChangePassword: input.previousMustChangePassword },
		ip: input.ip,
		requestId: input.requestId,
		resourceId: input.actorId,
		resourceType: "administrator",
		result: "success",
		userAgent: input.userAgent,
	});
}

export function createProfileRepository(
	database: Pick<Database, "transaction" | "update"> = getDatabase(),
): ProfileRepository {
	return {
		beginPasswordChange: (input) => beginPasswordChange(database, input),
		completePasswordChange: (input) =>
			database.transaction((transaction) =>
				completePasswordChangeInTransaction(transaction, input),
			),
	};
}
