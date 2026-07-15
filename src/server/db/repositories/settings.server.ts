import { and, eq, sql } from "drizzle-orm";
import type { SupportedLocale } from "../../../shared/api/common";
import type { SystemSettingsPageSize } from "../../../shared/api/settings";
import { type Database, getDatabase } from "../client.server";
import { systemSettings } from "../schema";
import { createAuditRepository } from "./audit.server";

type DatabaseTransaction = Parameters<
	Parameters<Database["transaction"]>[0]
>[0];
type SettingsDatabase = Pick<Database, "insert" | "select" | "transaction">;
type SettingsReadDatabase = Pick<Database, "select">;
type SettingsInsertDatabase = Pick<Database, "insert">;
type SettingsInitializeDatabase = SettingsInsertDatabase & SettingsReadDatabase;

export interface SystemSettingsRecord {
	readonly defaultLocale: string;
	readonly defaultPageSize: number;
	readonly repositoryUrl: string | null;
	readonly rowVersion: bigint;
	readonly systemName: string;
	readonly updatedAt: Date;
	readonly updatedBy: string | null;
}

export interface SettingsMutationContext {
	readonly actorId: string;
	readonly ip: string | null;
	readonly requestId: string;
	readonly userAgent: string | null;
}

export interface UpdateSystemSettingsRepositoryInput {
	readonly audit: SettingsMutationContext;
	readonly defaultLocale: SupportedLocale;
	readonly defaultPageSize: SystemSettingsPageSize;
	readonly expectedRowVersion: bigint;
	readonly now: Date;
	readonly repositoryUrl: string | null;
	readonly systemName: string;
}

export interface SettingsRepository {
	getOrCreate(): Promise<SystemSettingsRecord>;
	update(
		input: UpdateSystemSettingsRepositoryInput,
	): Promise<SystemSettingsRecord>;
}

export class SettingsStaleWriteRepositoryError extends Error {
	constructor() {
		super("System settings row version is stale.");
		this.name = "SettingsStaleWriteRepositoryError";
	}
}

const SETTINGS_SINGLETON_ID = 1;

const SETTINGS_SELECTION = {
	defaultLocale: systemSettings.defaultLocale,
	defaultPageSize: systemSettings.defaultPageSize,
	repositoryUrl: systemSettings.repositoryUrl,
	rowVersion: systemSettings.rowVersion,
	systemName: systemSettings.systemName,
	updatedAt: systemSettings.updatedAt,
	updatedBy: systemSettings.updatedBy,
} as const;

async function ensureSingleton(
	database: SettingsInsertDatabase,
): Promise<void> {
	await database
		.insert(systemSettings)
		.values({ id: SETTINGS_SINGLETON_ID })
		.onConflictDoNothing({ target: systemSettings.id });
}

async function readSingleton(
	database: SettingsReadDatabase,
): Promise<SystemSettingsRecord> {
	const [record] = await database
		.select(SETTINGS_SELECTION)
		.from(systemSettings)
		.where(eq(systemSettings.id, SETTINGS_SINGLETON_ID))
		.limit(1);
	if (!record)
		throw new Error("System settings singleton was not initialized.");
	return record;
}

/**
 * Canonical singleton initialization/read path shared by settings and account
 * creation transactions.
 */
export async function getOrCreateSystemSettings(
	database: SettingsInitializeDatabase,
): Promise<SystemSettingsRecord> {
	await ensureSingleton(database);
	return readSingleton(database);
}

async function lockSingleton(
	transaction: DatabaseTransaction,
): Promise<SystemSettingsRecord> {
	const [record] = await transaction
		.select(SETTINGS_SELECTION)
		.from(systemSettings)
		.where(eq(systemSettings.id, SETTINGS_SINGLETON_ID))
		.limit(1)
		.for("update");
	if (!record)
		throw new Error("System settings singleton was not initialized.");
	return record;
}

function auditValue(record: SystemSettingsRecord) {
	return {
		defaultLocale: record.defaultLocale,
		defaultPageSize: record.defaultPageSize,
		repositoryUrl: record.repositoryUrl,
		systemName: record.systemName,
	};
}

export function createSettingsRepository(
	database?: SettingsDatabase,
): SettingsRepository {
	const resolveDatabase = () => database ?? getDatabase();

	return {
		async getOrCreate() {
			return getOrCreateSystemSettings(resolveDatabase());
		},
		async update(input) {
			return resolveDatabase().transaction(async (transaction) => {
				await ensureSingleton(transaction);
				const before = await lockSingleton(transaction);
				if (before.rowVersion !== input.expectedRowVersion) {
					throw new SettingsStaleWriteRepositoryError();
				}

				const [updated] = await transaction
					.update(systemSettings)
					.set({
						defaultLocale: input.defaultLocale,
						defaultPageSize: input.defaultPageSize,
						repositoryUrl: input.repositoryUrl,
						rowVersion: sql`${systemSettings.rowVersion} + 1`,
						systemName: input.systemName,
						updatedAt: input.now,
						updatedBy: input.audit.actorId,
					})
					.where(
						and(
							eq(systemSettings.id, SETTINGS_SINGLETON_ID),
							eq(systemSettings.rowVersion, input.expectedRowVersion),
						),
					)
					.returning(SETTINGS_SELECTION);
				if (!updated) throw new SettingsStaleWriteRepositoryError();

				await createAuditRepository(transaction).append({
					action: "system-settings.updated",
					actorId: input.audit.actorId,
					after: auditValue(updated),
					before: auditValue(before),
					ip: input.audit.ip,
					requestId: input.audit.requestId,
					resourceId: String(SETTINGS_SINGLETON_ID),
					resourceType: "system-settings",
					result: "success",
					userAgent: input.audit.userAgent,
				});
				return updated;
			});
		},
	};
}
