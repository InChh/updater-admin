import { and, asc, count, desc, eq, isNull, like, sql } from "drizzle-orm";

import type {
	ProgramPageSize,
	ProgramSort,
} from "../../../shared/api/programs";
import { type Database, getDatabase } from "../client.server";
import { applications, applicationVersions } from "../schema";
import { createAuditRepository } from "./audit.server";

type DatabaseTransaction = Parameters<
	Parameters<Database["transaction"]>[0]
>[0];
type ProgramsDatabase = Pick<Database, "select" | "transaction">;

export interface ProgramRecord {
	readonly createdAt: Date;
	readonly createdBy: string;
	readonly description: string | null;
	readonly id: string;
	readonly name: string;
	readonly rowVersion: bigint;
	readonly updatedAt: Date;
	readonly updatedBy: string;
}

export interface ProgramDetailRecord extends ProgramRecord {
	readonly versionCount: number;
}

export interface ProgramMutationContext {
	readonly actorId: string;
	readonly ip: string | null;
	readonly requestId: string;
	readonly userAgent: string | null;
}

export interface ListProgramsRepositoryInput {
	readonly name?: string;
	readonly page: number;
	readonly pageSize: ProgramPageSize;
	readonly sort: ProgramSort;
}

export interface ListProgramsRepositoryResult {
	readonly items: readonly ProgramRecord[];
	readonly total: number;
}

export interface CreateProgramRepositoryInput {
	readonly audit: ProgramMutationContext;
	readonly description: string | null;
	readonly name: string;
}

export interface UpdateProgramRepositoryInput {
	readonly audit: ProgramMutationContext;
	readonly description?: string | null;
	readonly expectedRowVersion: bigint;
	readonly id: string;
	readonly name?: string;
	readonly now: Date;
}

export interface DeleteProgramRepositoryInput {
	readonly audit: ProgramMutationContext;
	readonly expectedRowVersion: bigint;
	readonly id: string;
	readonly now: Date;
}

export interface DeleteProgramRepositoryResult {
	readonly affectedVersionCount: number;
}

export interface ProgramsRepository {
	create(input: CreateProgramRepositoryInput): Promise<ProgramDetailRecord>;
	delete(
		input: DeleteProgramRepositoryInput,
	): Promise<DeleteProgramRepositoryResult>;
	findById(id: string): Promise<ProgramDetailRecord | null>;
	list(
		input: ListProgramsRepositoryInput,
	): Promise<ListProgramsRepositoryResult>;
	update(input: UpdateProgramRepositoryInput): Promise<ProgramDetailRecord>;
}

export class ProgramNotFoundRepositoryError extends Error {
	constructor() {
		super("Program was not found.");
		this.name = "ProgramNotFoundRepositoryError";
	}
}

export class ProgramStaleWriteRepositoryError extends Error {
	constructor() {
		super("Program row version is stale.");
		this.name = "ProgramStaleWriteRepositoryError";
	}
}

export class ProgramNameConflictRepositoryError extends Error {
	constructor() {
		super("A live program already uses this name.");
		this.name = "ProgramNameConflictRepositoryError";
	}
}

const PROGRAM_SELECTION = {
	createdAt: applications.createdAt,
	createdBy: applications.createdBy,
	description: applications.description,
	id: applications.id,
	name: applications.name,
	rowVersion: applications.rowVersion,
	updatedAt: applications.updatedAt,
	updatedBy: applications.updatedBy,
} as const;

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

const MAX_DATABASE_ERROR_CAUSE_DEPTH = 8;

export function isLiveProgramNameUniqueViolation(error: unknown): boolean {
	const visited = new Set<object>();
	let current = error;

	for (
		let depth = 0;
		depth < MAX_DATABASE_ERROR_CAUSE_DEPTH && isRecord(current);
		depth++
	) {
		if (visited.has(current)) return false;
		visited.add(current);

		if (
			current.code === "23505" &&
			current.constraint === "applications_live_name_unique"
		) {
			return true;
		}

		current = current.cause;
	}

	return false;
}

export function escapeLikeLiteral(value: string): string {
	return value
		.replaceAll("\\", "\\\\")
		.replaceAll("%", "\\%")
		.replaceAll("_", "\\_");
}

async function mapNameConflict<T>(operation: () => Promise<T>): Promise<T> {
	try {
		return await operation();
	} catch (error) {
		if (isLiveProgramNameUniqueViolation(error)) {
			throw new ProgramNameConflictRepositoryError();
		}
		throw error;
	}
}

async function lockLiveProgram(
	transaction: DatabaseTransaction,
	id: string,
): Promise<ProgramRecord> {
	const [program] = await transaction
		.select(PROGRAM_SELECTION)
		.from(applications)
		.where(and(eq(applications.id, id), isNull(applications.deletedAt)))
		.limit(1)
		.for("update");
	if (!program) throw new ProgramNotFoundRepositoryError();
	return program;
}

function assertCurrentRowVersion(
	program: ProgramRecord,
	expectedRowVersion: bigint,
): void {
	if (program.rowVersion !== expectedRowVersion) {
		throw new ProgramStaleWriteRepositoryError();
	}
}

function auditInput(
	context: ProgramMutationContext,
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
		resourceType: "program",
		result: "success" as const,
		userAgent: context.userAgent,
	};
}

export function createProgramsRepository(
	database?: ProgramsDatabase,
): ProgramsRepository {
	const resolveDatabase = () => database ?? getDatabase();

	return {
		create: (input) =>
			mapNameConflict(() =>
				resolveDatabase().transaction(async (transaction) => {
					const [created] = await transaction
						.insert(applications)
						.values({
							createdBy: input.audit.actorId,
							description: input.description,
							name: input.name,
							updatedBy: input.audit.actorId,
						})
						.returning(PROGRAM_SELECTION);
					if (!created) throw new Error("Program insert returned no row.");

					await createAuditRepository(transaction).append(
						auditInput(input.audit, {
							action: "program.created",
							after: created,
							resourceId: created.id,
						}),
					);
					return { ...created, versionCount: 0 };
				}),
			),
		async delete(input) {
			return resolveDatabase().transaction(async (transaction) => {
				const before = await lockLiveProgram(transaction, input.id);
				assertCurrentRowVersion(before, input.expectedRowVersion);

				const deletedVersions = await transaction
					.update(applicationVersions)
					.set({
						deletedAt: input.now,
						deletedBy: input.audit.actorId,
						rowVersion: sql`${applicationVersions.rowVersion} + 1`,
						updatedAt: input.now,
						updatedBy: input.audit.actorId,
					})
					.where(
						and(
							eq(applicationVersions.applicationId, input.id),
							isNull(applicationVersions.deletedAt),
						),
					)
					.returning({ id: applicationVersions.id });

				const [deleted] = await transaction
					.update(applications)
					.set({
						deletedAt: input.now,
						deletedBy: input.audit.actorId,
						rowVersion: sql`${applications.rowVersion} + 1`,
						updatedAt: input.now,
						updatedBy: input.audit.actorId,
					})
					.where(
						and(
							eq(applications.id, input.id),
							isNull(applications.deletedAt),
							eq(applications.rowVersion, input.expectedRowVersion),
						),
					)
					.returning(PROGRAM_SELECTION);
				if (!deleted) throw new ProgramStaleWriteRepositoryError();

				await createAuditRepository(transaction).append(
					auditInput(input.audit, {
						action: "program.deleted",
						after: {
							...deleted,
							affectedVersionCount: deletedVersions.length,
							deletedAt: input.now,
							deletedBy: input.audit.actorId,
						},
						before,
						resourceId: input.id,
					}),
				);
				return { affectedVersionCount: deletedVersions.length };
			});
		},
		async findById(id) {
			const [program] = await resolveDatabase()
				.select({
					...PROGRAM_SELECTION,
					versionCount: count(applicationVersions.id),
				})
				.from(applications)
				.leftJoin(
					applicationVersions,
					and(
						eq(applicationVersions.applicationId, applications.id),
						isNull(applicationVersions.deletedAt),
					),
				)
				.where(and(eq(applications.id, id), isNull(applications.deletedAt)))
				.groupBy(applications.id)
				.limit(1);
			return program ?? null;
		},
		async list(input) {
			const filters = [isNull(applications.deletedAt)];
			if (input.name !== undefined) {
				filters.push(
					like(applications.name, `%${escapeLikeLiteral(input.name)}%`),
				);
			}
			const where = and(...filters);
			const orderBy =
				input.sort === "createdAt:asc"
					? [asc(applications.createdAt), asc(applications.id)]
					: [desc(applications.createdAt), desc(applications.id)];
			const databaseClient = resolveDatabase();
			const [items, totalRows] = await Promise.all([
				databaseClient
					.select(PROGRAM_SELECTION)
					.from(applications)
					.where(where)
					.orderBy(...orderBy)
					.limit(input.pageSize)
					.offset((input.page - 1) * input.pageSize),
				databaseClient
					.select({ value: count() })
					.from(applications)
					.where(where),
			]);
			return {
				items,
				total: Number(totalRows[0]?.value ?? 0),
			};
		},
		update: (input) =>
			mapNameConflict(() =>
				resolveDatabase().transaction(async (transaction) => {
					const before = await lockLiveProgram(transaction, input.id);
					assertCurrentRowVersion(before, input.expectedRowVersion);

					const [updated] = await transaction
						.update(applications)
						.set({
							...(input.description === undefined
								? {}
								: { description: input.description }),
							...(input.name === undefined ? {} : { name: input.name }),
							rowVersion: sql`${applications.rowVersion} + 1`,
							updatedAt: input.now,
							updatedBy: input.audit.actorId,
						})
						.where(
							and(
								eq(applications.id, input.id),
								isNull(applications.deletedAt),
								eq(applications.rowVersion, input.expectedRowVersion),
							),
						)
						.returning(PROGRAM_SELECTION);
					if (!updated) throw new ProgramStaleWriteRepositoryError();

					await createAuditRepository(transaction).append(
						auditInput(input.audit, {
							action: "program.updated",
							after: updated,
							before,
							resourceId: input.id,
						}),
					);
					const [versionTotal] = await transaction
						.select({ value: count() })
						.from(applicationVersions)
						.where(
							and(
								eq(applicationVersions.applicationId, input.id),
								isNull(applicationVersions.deletedAt),
							),
						);
					return {
						...updated,
						versionCount: Number(versionTotal?.value ?? 0),
					};
				}),
			),
	};
}
