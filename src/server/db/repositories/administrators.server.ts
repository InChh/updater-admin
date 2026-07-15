import { and, asc, count, desc, eq, ilike, or, sql } from "drizzle-orm";

import type {
	AdministratorListSearch,
	AdministratorPageSize,
	AdministratorSort,
} from "../../../shared/api/administrators";
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
type AdministratorsDatabase = Pick<Database, "select" | "transaction">;

// One product-wide lock is intentional: the invariant is global, not row-local.
export const ADMINISTRATOR_STATUS_ADVISORY_LOCK = 7_410_150_202_610;

export interface AdministratorRecord {
	readonly banned: boolean | null;
	readonly createdAt: Date;
	readonly email: string;
	readonly id: string;
	readonly lastLoginAt: Date | null;
	readonly locale: SupportedLocale;
	readonly mustChangePassword: boolean;
	readonly name: string;
	readonly rowVersion: bigint;
	readonly updatedAt: Date;
}

export interface AdministratorMutationContext {
	readonly actorId: string;
	readonly ip: string | null;
	readonly requestId: string;
	readonly userAgent: string | null;
}

export interface ListAdministratorsRepositoryInput {
	readonly page: number;
	readonly pageSize: AdministratorPageSize;
	readonly query?: string;
	readonly sort: AdministratorSort;
	readonly status?: AdministratorListSearch["status"];
}

export interface ListAdministratorsRepositoryResult {
	readonly items: readonly AdministratorRecord[];
	readonly total: number;
}

export interface UpdateAdministratorRepositoryInput {
	readonly audit: AdministratorMutationContext;
	readonly enabled?: boolean;
	readonly expectedRowVersion: bigint;
	readonly headers: Headers;
	readonly id: string;
	readonly locale?: SupportedLocale;
	readonly name?: string;
}

export interface RevokeAdministratorSessionsRepositoryInput {
	readonly audit: AdministratorMutationContext;
	readonly headers: Headers;
	readonly id: string;
}

export interface AdministratorsRepository {
	findById(id: string): Promise<AdministratorRecord | null>;
	list(
		input: ListAdministratorsRepositoryInput,
	): Promise<ListAdministratorsRepositoryResult>;
	revokeSessions(
		input: RevokeAdministratorSessionsRepositoryInput,
	): Promise<void>;
	update(
		input: UpdateAdministratorRepositoryInput,
	): Promise<AdministratorRecord>;
}

export class AdministratorNotFoundRepositoryError extends Error {
	constructor() {
		super("Administrator was not found.");
		this.name = "AdministratorNotFoundRepositoryError";
	}
}

export class AdministratorSelfDisableRepositoryError extends Error {
	constructor() {
		super("An administrator cannot disable the current account.");
		this.name = "AdministratorSelfDisableRepositoryError";
	}
}

export class LastActiveAdministratorRepositoryError extends Error {
	constructor() {
		super("At least one active administrator is required.");
		this.name = "LastActiveAdministratorRepositoryError";
	}
}

export class AdministratorStaleWriteRepositoryError extends Error {
	constructor() {
		super("Administrator row version is stale.");
		this.name = "AdministratorStaleWriteRepositoryError";
	}
}

type AdministratorAuthApi = Pick<
	AppAuth["api"],
	"adminUpdateUser" | "banUser" | "revokeUserSessions" | "unbanUser"
>;

export interface AdministratorsRepositoryRuntimeDependencies {
	readonly createAuthApi?: (
		transaction: DatabaseTransaction,
	) => AdministratorAuthApi;
	readonly environment?: EnvironmentSource;
}

const ADMINISTRATOR_SELECTION = {
	banned: user.banned,
	createdAt: user.createdAt,
	email: user.email,
	id: user.id,
	lastLoginAt: adminMetadata.lastLoginAt,
	locale: adminMetadata.locale,
	mustChangePassword: adminMetadata.mustChangePassword,
	name: user.name,
	rowVersion: adminMetadata.rowVersion,
	updatedAt: user.updatedAt,
} as const;

type SelectedAdministrator = Omit<AdministratorRecord, "locale"> & {
	readonly locale: string;
};

function normalizeRecord(record: SelectedAdministrator): AdministratorRecord {
	return {
		...record,
		locale: record.locale === "en" ? "en" : "zh-CN",
	};
}

function activeCondition() {
	return sql<boolean>`coalesce(${user.banned}, false) = false`;
}

function listWhere(input: ListAdministratorsRepositoryInput) {
	const filters = [eq(user.role, "admin")];
	if (input.query !== undefined) {
		const queryCondition = or(
			ilike(user.name, `%${escapeLikeLiteral(input.query)}%`),
			ilike(user.email, `%${escapeLikeLiteral(input.query)}%`),
		);
		if (queryCondition) filters.push(queryCondition);
	}
	if (input.status === "active") filters.push(activeCondition());
	if (input.status === "disabled") filters.push(eq(user.banned, true));
	return and(...filters);
}

function listOrder(sort: AdministratorSort) {
	switch (sort) {
		case "createdAt:asc":
			return [asc(user.createdAt), asc(user.id)] as const;
		case "name:asc":
			return [asc(user.name), asc(user.id)] as const;
		case "name:desc":
			return [desc(user.name), desc(user.id)] as const;
		default:
			return [desc(user.createdAt), desc(user.id)] as const;
	}
}

export function escapeLikeLiteral(value: string): string {
	return value
		.replaceAll("\\", "\\\\")
		.replaceAll("%", "\\%")
		.replaceAll("_", "\\_");
}

async function selectAdministrator(
	database: Pick<Database, "select">,
	id: string,
): Promise<AdministratorRecord | null> {
	const [record] = await database
		.select(ADMINISTRATOR_SELECTION)
		.from(user)
		.innerJoin(adminMetadata, eq(adminMetadata.userId, user.id))
		.where(and(eq(user.id, id), eq(user.role, "admin")))
		.limit(1);
	return record ? normalizeRecord(record) : null;
}

async function lockAdministrator(
	transaction: DatabaseTransaction,
	id: string,
): Promise<AdministratorRecord> {
	const [record] = await transaction
		.select(ADMINISTRATOR_SELECTION)
		.from(user)
		.innerJoin(adminMetadata, eq(adminMetadata.userId, user.id))
		.where(and(eq(user.id, id), eq(user.role, "admin")))
		.limit(1)
		.for("update");
	if (!record) throw new AdministratorNotFoundRepositoryError();
	return normalizeRecord(record);
}

function safeAuditState(record: AdministratorRecord) {
	return {
		email: record.email,
		enabled: !(record.banned ?? false),
		id: record.id,
		locale: record.locale,
		mustChangePassword: record.mustChangePassword,
		name: record.name,
		rowVersion: record.rowVersion.toString(),
	};
}

function assertCurrentRowVersion(
	record: AdministratorRecord,
	expectedRowVersion: bigint,
): void {
	if (record.rowVersion !== expectedRowVersion) {
		throw new AdministratorStaleWriteRepositoryError();
	}
}

function auditInput(
	context: AdministratorMutationContext,
	input: {
		readonly action: string;
		readonly after?: unknown;
		readonly before?: unknown;
		readonly resourceId: string;
	},
) {
	return {
		action: input.action,
		actorId: context.actorId,
		after: input.after,
		before: input.before,
		ip: context.ip,
		requestId: context.requestId,
		resourceId: input.resourceId,
		resourceType: "administrator",
		result: "success" as const,
		userAgent: context.userAgent,
	};
}

function defaultAuthApiFactory(
	environment?: EnvironmentSource,
): (transaction: DatabaseTransaction) => AdministratorAuthApi {
	return (transaction) =>
		createAuth({
			database: transaction as AuthDatabase,
			databaseTransaction: false,
			environment,
			updateLastLogin: async () => {},
		}).api;
}

export function createAdministratorsRepository(
	database?: AdministratorsDatabase,
	runtime: AdministratorsRepositoryRuntimeDependencies = {},
): AdministratorsRepository {
	const resolveDatabase = () => database ?? getDatabase();
	const createAuthApi =
		runtime.createAuthApi ?? defaultAuthApiFactory(runtime.environment);

	return {
		findById: (id) => selectAdministrator(resolveDatabase(), id),
		async list(input) {
			const databaseClient = resolveDatabase();
			const where = listWhere(input);
			const orderBy = listOrder(input.sort);
			const [items, totals] = await Promise.all([
				databaseClient
					.select(ADMINISTRATOR_SELECTION)
					.from(user)
					.innerJoin(adminMetadata, eq(adminMetadata.userId, user.id))
					.where(where)
					.orderBy(...orderBy)
					.limit(input.pageSize)
					.offset((input.page - 1) * input.pageSize),
				databaseClient
					.select({ value: count() })
					.from(user)
					.innerJoin(adminMetadata, eq(adminMetadata.userId, user.id))
					.where(where),
			]);
			return {
				items: items.map(normalizeRecord),
				total: Number(totals[0]?.value ?? 0),
			};
		},
		async revokeSessions(input) {
			await resolveDatabase().transaction(async (transaction) => {
				const administrator = await lockAdministrator(transaction, input.id);
				await createAuthApi(transaction).revokeUserSessions({
					body: { userId: input.id },
					headers: input.headers,
				});
				await createAuditRepository(transaction).append(
					auditInput(input.audit, {
						action: "administrator.sessions.revoked",
						after: { sessionsRevoked: true },
						before: safeAuditState(administrator),
						resourceId: input.id,
					}),
				);
			});
		},
		async update(input) {
			return resolveDatabase().transaction(async (transaction) => {
				await transaction.execute(
					sql`select pg_advisory_xact_lock(${ADMINISTRATOR_STATUS_ADVISORY_LOCK})`,
				);
				const before = await lockAdministrator(transaction, input.id);
				assertCurrentRowVersion(before, input.expectedRowVersion);
				const wasEnabled = !(before.banned ?? false);
				const changingEnabled =
					input.enabled !== undefined && input.enabled !== wasEnabled;

				if (changingEnabled && input.enabled === false) {
					if (input.id === input.audit.actorId) {
						throw new AdministratorSelfDisableRepositoryError();
					}
					const [active] = await transaction
						.select({ value: count() })
						.from(user)
						.where(and(eq(user.role, "admin"), activeCondition()));
					if (Number(active?.value ?? 0) <= 1) {
						throw new LastActiveAdministratorRepositoryError();
					}
				}

				const auth = createAuthApi(transaction);
				if (input.name !== undefined && input.name !== before.name) {
					await auth.adminUpdateUser({
						body: { data: { name: input.name }, userId: input.id },
						headers: input.headers,
					});
				}
				if (changingEnabled && input.enabled === false) {
					await auth.banUser({
						body: {
							banReason: "Disabled by an administrator",
							userId: input.id,
						},
						headers: input.headers,
					});
				}
				if (changingEnabled && input.enabled === true) {
					await auth.unbanUser({
						body: { userId: input.id },
						headers: input.headers,
					});
				}

				const [changedMetadata] = await transaction
					.update(adminMetadata)
					.set({
						...(input.locale === undefined ? {} : { locale: input.locale }),
						rowVersion: sql`${adminMetadata.rowVersion} + 1`,
					})
					.where(
						and(
							eq(adminMetadata.userId, input.id),
							eq(adminMetadata.rowVersion, input.expectedRowVersion),
						),
					)
					.returning({ userId: adminMetadata.userId });
				if (!changedMetadata) {
					throw new AdministratorStaleWriteRepositoryError();
				}

				const after = await selectAdministrator(transaction, input.id);
				if (!after) throw new AdministratorNotFoundRepositoryError();
				await createAuditRepository(transaction).append(
					auditInput(input.audit, {
						action: "administrator.updated",
						after: safeAuditState(after),
						before: safeAuditState(before),
						resourceId: input.id,
					}),
				);
				return after;
			});
		},
	};
}
