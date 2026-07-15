import { and, eq, sql } from "drizzle-orm";

import type { SupportedLocale } from "../../../shared/api/common";
import {
	type AppAuth,
	type AuthDatabase,
	createAuth,
} from "../../auth/auth.server";
import type { EnvironmentSource } from "../../env.server";
import { type Database, getDatabase } from "../client.server";
import { adminMetadata, user } from "../schema";
import { createAuditRepository } from "./audit.server";

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

export interface UpdateProfileRepositoryInput {
	readonly actorId: string;
	readonly expectedRowVersion: bigint;
	readonly headers: Headers;
	readonly ip: string | null;
	readonly locale: SupportedLocale;
	readonly name: string;
	readonly requestId: string;
	readonly userAgent: string | null;
}

export interface ProfileUpdateRecord {
	readonly locale: SupportedLocale;
	readonly name: string;
	readonly rowVersion: bigint;
}

export class ProfileStaleWriteRepositoryError extends Error {
	constructor() {
		super("Profile row version is stale.");
		this.name = "ProfileStaleWriteRepositoryError";
	}
}

export interface ProfileRepository {
	beginPasswordChange(input: BeginPasswordChangeInput): Promise<void>;
	completePasswordChange(input: CompletePasswordChangeInput): Promise<void>;
	updateProfile(
		input: UpdateProfileRepositoryInput,
	): Promise<ProfileUpdateRecord>;
}

type ProfileUpdateAuthApi = Pick<AppAuth["api"], "updateUser">;

export interface ProfileRepositoryRuntimeDependencies {
	readonly createAuthApi?: (
		transaction: DatabaseTransaction,
	) => ProfileUpdateAuthApi;
	readonly environment?: EnvironmentSource;
}

async function beginPasswordChange(
	database: Pick<Database, "update">,
	input: BeginPasswordChangeInput,
): Promise<void> {
	const updated = await database
		.update(adminMetadata)
		.set({
			mustChangePassword: true,
			rowVersion: sql`${adminMetadata.rowVersion} + 1`,
		})
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
		.set({
			mustChangePassword: false,
			rowVersion: sql`${adminMetadata.rowVersion} + 1`,
		})
		.where(eq(adminMetadata.userId, input.actorId))
		.returning({ userId: adminMetadata.userId });
	if (updated.length !== 1) {
		throw new Error("Administrator metadata was not updated.");
	}

	await createAuditRepository(transaction).append({
		action: "profile.password.changed",
		actorId: input.actorId,
		after: { mustChangePassword: false },
		before: { mustChangePassword: input.previousMustChangePassword },
		ip: input.ip,
		requestId: input.requestId,
		resourceId: input.actorId,
		resourceType: "profile",
		result: "success",
		userAgent: input.userAgent,
	});
}

async function updateProfileInTransaction(
	transaction: DatabaseTransaction,
	input: UpdateProfileRepositoryInput,
	createAuthApi: (transaction: DatabaseTransaction) => ProfileUpdateAuthApi,
): Promise<ProfileUpdateRecord> {
	const [before] = await transaction
		.select({
			locale: adminMetadata.locale,
			name: user.name,
			rowVersion: adminMetadata.rowVersion,
		})
		.from(user)
		.innerJoin(adminMetadata, eq(adminMetadata.userId, user.id))
		.where(and(eq(user.id, input.actorId), eq(user.role, "admin")))
		.limit(1)
		.for("update");
	if (!before) throw new Error("Administrator profile was not found.");
	if (before.rowVersion !== input.expectedRowVersion) {
		throw new ProfileStaleWriteRepositoryError();
	}

	if (input.name !== before.name) {
		await createAuthApi(transaction).updateUser({
			body: { name: input.name },
			headers: input.headers,
		});
	}

	const [updated] = await transaction
		.update(adminMetadata)
		.set({
			locale: input.locale,
			rowVersion: sql`${adminMetadata.rowVersion} + 1`,
		})
		.where(
			and(
				eq(adminMetadata.userId, input.actorId),
				eq(adminMetadata.rowVersion, input.expectedRowVersion),
			),
		)
		.returning({
			locale: adminMetadata.locale,
			rowVersion: adminMetadata.rowVersion,
		});
	if (!updated) {
		throw new ProfileStaleWriteRepositoryError();
	}
	const after = {
		locale: updated.locale === "en" ? ("en" as const) : ("zh-CN" as const),
		name: input.name,
		rowVersion: updated.rowVersion,
	};

	await createAuditRepository(transaction).append({
		action: "profile.updated",
		actorId: input.actorId,
		after: {
			locale: after.locale,
			name: after.name,
			rowVersion: after.rowVersion.toString(),
		},
		before: {
			locale: before.locale,
			name: before.name,
			rowVersion: before.rowVersion.toString(),
		},
		ip: input.ip,
		requestId: input.requestId,
		resourceId: input.actorId,
		resourceType: "profile",
		result: "success",
		userAgent: input.userAgent,
	});
	return after;
}

export function createProfileRepository(
	database: Pick<Database, "transaction" | "update"> = getDatabase(),
	runtime: ProfileRepositoryRuntimeDependencies = {},
): ProfileRepository {
	const createAuthApi =
		runtime.createAuthApi ??
		((transaction: DatabaseTransaction) =>
			createAuth({
				database: transaction as AuthDatabase,
				databaseTransaction: false,
				environment: runtime.environment,
				updateLastLogin: async () => {},
			}).api);
	return {
		beginPasswordChange: (input) => beginPasswordChange(database, input),
		completePasswordChange: (input) =>
			database.transaction((transaction) =>
				completePasswordChangeInTransaction(transaction, input),
			),
		updateProfile: (input) =>
			database.transaction((transaction) =>
				updateProfileInTransaction(transaction, input, createAuthApi),
			),
	};
}
