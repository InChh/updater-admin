import {
	and,
	asc,
	count,
	countDistinct,
	desc,
	eq,
	isNull,
	sql,
} from "drizzle-orm";

import type {
	VersionLifecycleStatus,
	VersionPageSize,
	VersionSort,
} from "../../../shared/api/versions";
import { type Database, getDatabase } from "../client.server";
import {
	applications,
	applicationVersions,
	fileMetadata,
	versionFiles,
} from "../schema";
import { createAuditRepository } from "./audit.server";
import {
	type ProgramMutationContext,
	ProgramNotFoundRepositoryError,
} from "./programs.server";

type DatabaseTransaction = Parameters<
	Parameters<Database["transaction"]>[0]
>[0];
type VersionsDatabase = Pick<Database, "select" | "transaction">;

export interface VersionRecord {
	readonly associatedFileCount: number;
	readonly createdAt: Date;
	readonly createdBy: string;
	readonly description: string;
	readonly expectedFileCount: number | null;
	readonly fileCount: number;
	readonly finalizedAt: Date | null;
	readonly id: string;
	readonly isActive: boolean;
	readonly isLatest: boolean;
	readonly lifecycleStatus: VersionLifecycleStatus;
	readonly programId: string;
	readonly rowVersion: bigint;
	readonly updatedAt: Date;
	readonly updatedBy: string;
	readonly versionMajor: number;
	readonly versionMinor: number;
	readonly versionNumber: string;
	readonly versionPatch: number;
}

export type VersionDetailRecord = VersionRecord;

export interface VersionNumberRepositoryValue {
	readonly versionMajor: number;
	readonly versionMinor: number;
	readonly versionNumber: string;
	readonly versionPatch: number;
}

export interface ListVersionsRepositoryInput {
	readonly page: number;
	readonly pageSize: VersionPageSize;
	readonly programId: string;
	readonly sort: VersionSort;
}

export interface ListVersionsRepositoryResult {
	readonly items: readonly VersionRecord[];
	readonly total: number;
}

export interface CreateDraftVersionRepositoryInput
	extends VersionNumberRepositoryValue {
	readonly audit: ProgramMutationContext;
	readonly description: string;
	readonly expectedFileCount: number;
	readonly programId: string;
}

export interface FinalizeDraftVersionRepositoryInput {
	readonly audit: ProgramMutationContext;
	readonly expectedRowVersion: bigint;
	readonly id: string;
	readonly now: Date;
	readonly programId: string;
}

export interface UpdateVersionRepositoryInput {
	readonly audit: ProgramMutationContext;
	readonly description?: string;
	readonly expectedRowVersion: bigint;
	readonly id: string;
	readonly now: Date;
	readonly programId: string;
	readonly versionMajor?: number;
	readonly versionMinor?: number;
	readonly versionNumber?: string;
	readonly versionPatch?: number;
}

export interface DeleteVersionRepositoryInput {
	readonly audit: ProgramMutationContext;
	readonly expectedRowVersion: bigint;
	readonly id: string;
	readonly now: Date;
	readonly programId: string;
}

export interface SetVersionActivationRepositoryInput {
	readonly audit: ProgramMutationContext;
	readonly expectedRowVersion: bigint;
	readonly id: string;
	readonly isActive: boolean;
	readonly now: Date;
	readonly programId: string;
}

export interface VersionsRepository {
	createDraft(
		input: CreateDraftVersionRepositoryInput,
	): Promise<VersionDetailRecord>;
	delete(input: DeleteVersionRepositoryInput): Promise<void>;
	finalize(
		input: FinalizeDraftVersionRepositoryInput,
	): Promise<VersionDetailRecord>;
	findById(programId: string, id: string): Promise<VersionDetailRecord | null>;
	list(
		input: ListVersionsRepositoryInput,
	): Promise<ListVersionsRepositoryResult>;
	setActivation(
		input: SetVersionActivationRepositoryInput,
	): Promise<VersionDetailRecord>;
	update(input: UpdateVersionRepositoryInput): Promise<VersionDetailRecord>;
}

export class VersionNotFoundRepositoryError extends Error {
	constructor() {
		super("Version was not found.");
		this.name = "VersionNotFoundRepositoryError";
	}
}

export class VersionStaleWriteRepositoryError extends Error {
	constructor() {
		super("Version row version is stale.");
		this.name = "VersionStaleWriteRepositoryError";
	}
}

export class VersionNotGreaterRepositoryError extends Error {
	readonly currentMax?: string;

	constructor(currentMax?: string) {
		super(
			currentMax
				? `Version number must be greater than ${currentMax}.`
				: "Version number must be greater than the current maximum version.",
		);
		this.name = "VersionNotGreaterRepositoryError";
		this.currentMax = currentMax;
	}
}

export class VersionNumberConflictRepositoryError extends Error {
	constructor() {
		super("A live version already uses this number.");
		this.name = "VersionNumberConflictRepositoryError";
	}
}

export class VersionDraftRequiredRepositoryError extends Error {
	constructor() {
		super("The operation requires a draft version.");
		this.name = "VersionDraftRequiredRepositoryError";
	}
}

export class VersionFinalizedRequiredRepositoryError extends Error {
	constructor() {
		super("The operation requires a finalized version.");
		this.name = "VersionFinalizedRequiredRepositoryError";
	}
}

export class DraftIncompleteRepositoryError extends Error {
	readonly actual: number;
	readonly expected: number;

	constructor(expected: number, actual: number) {
		super("The draft does not contain every expected file.");
		this.name = "DraftIncompleteRepositoryError";
		this.expected = expected;
		this.actual = actual;
	}
}

export class DraftFileCountConflictRepositoryError extends Error {
	readonly actual: number;
	readonly expected: number;

	constructor(expected: number, actual: number) {
		super("The draft contains more files than expected.");
		this.name = "DraftFileCountConflictRepositoryError";
		this.expected = expected;
		this.actual = actual;
	}
}

export class DraftPathConflictRepositoryError extends Error {
	constructor() {
		super("The draft contains duplicate canonical paths.");
		this.name = "DraftPathConflictRepositoryError";
	}
}

interface StoredVersionRecord {
	readonly createdAt: Date;
	readonly createdBy: string;
	readonly description: string;
	readonly expectedFileCount: number | null;
	readonly finalizedAt: Date | null;
	readonly id: string;
	readonly isActive: boolean;
	readonly lifecycleStatus: VersionLifecycleStatus;
	readonly programId: string;
	readonly rowVersion: bigint;
	readonly updatedAt: Date;
	readonly updatedBy: string;
	readonly versionMajor: number;
	readonly versionMinor: number;
	readonly versionNumber: string;
	readonly versionPatch: number;
}

const VERSION_SELECTION = {
	createdAt: applicationVersions.createdAt,
	createdBy: applicationVersions.createdBy,
	description: applicationVersions.description,
	expectedFileCount: applicationVersions.expectedFileCount,
	finalizedAt: applicationVersions.finalizedAt,
	id: applicationVersions.id,
	isActive: applicationVersions.isActive,
	lifecycleStatus: applicationVersions.lifecycleStatus,
	programId: applicationVersions.applicationId,
	rowVersion: applicationVersions.rowVersion,
	updatedAt: applicationVersions.updatedAt,
	updatedBy: applicationVersions.updatedBy,
	versionMajor: applicationVersions.versionMajor,
	versionMinor: applicationVersions.versionMinor,
	versionNumber: applicationVersions.versionNumber,
	versionPatch: applicationVersions.versionPatch,
} as const;

const VERSION_LIST_SELECTION = {
	...VERSION_SELECTION,
	associatedFileCount: sql<number>`(
		select count(*)::integer
		from ${versionFiles}
		where ${versionFiles.versionId} = ${applicationVersions.id}
	)`,
} as const;

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

export function isLiveVersionNumberUniqueViolation(error: unknown): boolean {
	return (
		isRecord(error) &&
		error.code === "23505" &&
		error.constraint === "application_versions_live_number_unique"
	);
}

async function mapVersionNumberConflict<T>(
	operation: () => Promise<T>,
): Promise<T> {
	try {
		return await operation();
	} catch (error) {
		if (isLiveVersionNumberUniqueViolation(error)) {
			throw new VersionNumberConflictRepositoryError();
		}
		throw error;
	}
}

export function compareVersionRepositoryValues(
	left: Pick<
		VersionNumberRepositoryValue,
		"versionMajor" | "versionMinor" | "versionPatch"
	>,
	right: Pick<
		VersionNumberRepositoryValue,
		"versionMajor" | "versionMinor" | "versionPatch"
	>,
): number {
	if (left.versionMajor !== right.versionMajor) {
		return left.versionMajor - right.versionMajor;
	}
	if (left.versionMinor !== right.versionMinor) {
		return left.versionMinor - right.versionMinor;
	}
	return left.versionPatch - right.versionPatch;
}

async function lockLiveProgram(
	transaction: DatabaseTransaction,
	programId: string,
): Promise<void> {
	const [program] = await transaction
		.select({ id: applications.id })
		.from(applications)
		.where(and(eq(applications.id, programId), isNull(applications.deletedAt)))
		.limit(1)
		.for("update");
	if (!program) throw new ProgramNotFoundRepositoryError();
}

async function assertLiveProgramExists(
	database: Pick<Database, "select">,
	programId: string,
): Promise<void> {
	const [program] = await database
		.select({ id: applications.id })
		.from(applications)
		.where(and(eq(applications.id, programId), isNull(applications.deletedAt)))
		.limit(1);
	if (!program) throw new ProgramNotFoundRepositoryError();
}

async function lockLiveVersion(
	transaction: DatabaseTransaction,
	programId: string,
	id: string,
): Promise<StoredVersionRecord> {
	const [version] = await transaction
		.select(VERSION_SELECTION)
		.from(applicationVersions)
		.where(
			and(
				eq(applicationVersions.id, id),
				eq(applicationVersions.applicationId, programId),
				isNull(applicationVersions.deletedAt),
			),
		)
		.limit(1)
		.for("update");
	if (!version) throw new VersionNotFoundRepositoryError();
	return version;
}

function assertCurrentRowVersion(
	version: StoredVersionRecord,
	expectedRowVersion: bigint,
): void {
	if (version.rowVersion !== expectedRowVersion) {
		throw new VersionStaleWriteRepositoryError();
	}
}

async function findLiveFinalizedMaximum(
	transaction: DatabaseTransaction,
	programId: string,
): Promise<VersionNumberRepositoryValue | null> {
	const [maximum] = await transaction
		.select({
			versionMajor: applicationVersions.versionMajor,
			versionMinor: applicationVersions.versionMinor,
			versionNumber: applicationVersions.versionNumber,
			versionPatch: applicationVersions.versionPatch,
		})
		.from(applicationVersions)
		.where(
			and(
				eq(applicationVersions.applicationId, programId),
				eq(applicationVersions.lifecycleStatus, "finalized"),
				isNull(applicationVersions.deletedAt),
			),
		)
		.orderBy(
			desc(applicationVersions.versionMajor),
			desc(applicationVersions.versionMinor),
			desc(applicationVersions.versionPatch),
			desc(applicationVersions.id),
		)
		.limit(1);
	return maximum ?? null;
}

async function assertNoLiveVersionNumberDuplicate(
	transaction: DatabaseTransaction,
	programId: string,
	version: VersionNumberRepositoryValue,
	excludeVersionId?: string,
): Promise<void> {
	const [duplicate] = await transaction
		.select({ id: applicationVersions.id })
		.from(applicationVersions)
		.where(
			and(
				eq(applicationVersions.applicationId, programId),
				eq(applicationVersions.versionMajor, version.versionMajor),
				eq(applicationVersions.versionMinor, version.versionMinor),
				eq(applicationVersions.versionPatch, version.versionPatch),
				isNull(applicationVersions.deletedAt),
			),
		)
		.limit(1);
	if (duplicate && duplicate.id !== excludeVersionId) {
		throw new VersionNumberConflictRepositoryError();
	}
}

function assertGreaterThanLiveFinalizedMaximum(
	version: VersionNumberRepositoryValue,
	maximum: VersionNumberRepositoryValue | null,
): void {
	if (maximum && compareVersionRepositoryValues(version, maximum) <= 0) {
		throw new VersionNotGreaterRepositoryError(maximum.versionNumber);
	}
}

async function findLatestActiveVersionId(
	database: Pick<Database, "select">,
	programId: string,
): Promise<string | null> {
	const [latest] = await database
		.select({ id: applicationVersions.id })
		.from(applicationVersions)
		.where(
			and(
				eq(applicationVersions.applicationId, programId),
				eq(applicationVersions.lifecycleStatus, "finalized"),
				eq(applicationVersions.isActive, true),
				isNull(applicationVersions.deletedAt),
			),
		)
		.orderBy(
			desc(applicationVersions.versionMajor),
			desc(applicationVersions.versionMinor),
			desc(applicationVersions.versionPatch),
			desc(applicationVersions.id),
		)
		.limit(1);
	return latest?.id ?? null;
}

async function readAssociatedFileCount(
	database: Pick<Database, "select">,
	versionId: string,
): Promise<number> {
	const [row] = await database
		.select({ value: count() })
		.from(versionFiles)
		.innerJoin(fileMetadata, eq(fileMetadata.id, versionFiles.fileMetadataId))
		.where(
			and(
				eq(versionFiles.versionId, versionId),
				isNull(fileMetadata.deletedAt),
			),
		);
	return Number(row?.value ?? 0);
}

function withDerivedVersionFields(
	version: StoredVersionRecord,
	associatedFileCount: number,
	latestActiveVersionId: string | null,
): VersionDetailRecord {
	return {
		...version,
		associatedFileCount,
		fileCount: associatedFileCount,
		isLatest: version.id === latestActiveVersionId,
	};
}

function versionAuditSummary(version: VersionDetailRecord) {
	return {
		associatedFileCount: version.associatedFileCount,
		expectedFileCount: version.expectedFileCount,
		isActive: version.isActive,
		lifecycleStatus: version.lifecycleStatus,
		versionNumber: version.versionNumber,
	};
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
		resourceType: "version",
		result: "success" as const,
		userAgent: context.userAgent,
	};
}

function requestedVersionNumber(
	input: UpdateVersionRepositoryInput,
): VersionNumberRepositoryValue | null {
	const values = [
		input.versionNumber,
		input.versionMajor,
		input.versionMinor,
		input.versionPatch,
	];
	if (values.every((value) => value === undefined)) return null;
	if (values.some((value) => value === undefined)) {
		throw new Error(
			"Version number fields must be supplied as one complete set.",
		);
	}
	return {
		versionMajor: input.versionMajor as number,
		versionMinor: input.versionMinor as number,
		versionNumber: input.versionNumber as string,
		versionPatch: input.versionPatch as number,
	};
}

export function createVersionsRepository(
	database?: VersionsDatabase,
): VersionsRepository {
	const resolveDatabase = () => database ?? getDatabase();

	return {
		createDraft: (input) =>
			mapVersionNumberConflict(() =>
				resolveDatabase().transaction(async (transaction) => {
					await lockLiveProgram(transaction, input.programId);
					await assertNoLiveVersionNumberDuplicate(
						transaction,
						input.programId,
						input,
					);
					const maximum = await findLiveFinalizedMaximum(
						transaction,
						input.programId,
					);
					assertGreaterThanLiveFinalizedMaximum(input, maximum);

					const [created] = await transaction
						.insert(applicationVersions)
						.values({
							applicationId: input.programId,
							createdBy: input.audit.actorId,
							description: input.description,
							expectedFileCount: input.expectedFileCount,
							finalizedAt: null,
							isActive: false,
							lifecycleStatus: "draft",
							updatedBy: input.audit.actorId,
							versionMajor: input.versionMajor,
							versionMinor: input.versionMinor,
							versionNumber: input.versionNumber,
							versionPatch: input.versionPatch,
						})
						.returning(VERSION_SELECTION);
					if (!created) throw new Error("Version insert returned no row.");
					const result = withDerivedVersionFields(created, 0, null);
					await createAuditRepository(transaction).append(
						auditInput(input.audit, {
							action: "version.draft.created",
							after: versionAuditSummary(result),
							resourceId: created.id,
						}),
					);
					return result;
				}),
			),
		async delete(input) {
			return resolveDatabase().transaction(async (transaction) => {
				await lockLiveProgram(transaction, input.programId);
				const stored = await lockLiveVersion(
					transaction,
					input.programId,
					input.id,
				);
				assertCurrentRowVersion(stored, input.expectedRowVersion);
				const associatedFileCount = await readAssociatedFileCount(
					transaction,
					input.id,
				);
				const beforeLatestId = await findLatestActiveVersionId(
					transaction,
					input.programId,
				);
				const before = withDerivedVersionFields(
					stored,
					associatedFileCount,
					beforeLatestId,
				);

				if (stored.lifecycleStatus === "draft") {
					await transaction
						.delete(versionFiles)
						.where(eq(versionFiles.versionId, input.id));
				}
				const [deleted] = await transaction
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
							eq(applicationVersions.id, input.id),
							eq(applicationVersions.applicationId, input.programId),
							isNull(applicationVersions.deletedAt),
							eq(applicationVersions.rowVersion, input.expectedRowVersion),
						),
					)
					.returning(VERSION_SELECTION);
				if (!deleted) throw new VersionStaleWriteRepositoryError();
				await createAuditRepository(transaction).append(
					auditInput(input.audit, {
						action: "version.deleted",
						after: {
							associatedFileCount:
								stored.lifecycleStatus === "draft" ? 0 : associatedFileCount,
							deleted: true,
							lifecycleStatus: stored.lifecycleStatus,
						},
						before: versionAuditSummary(before),
						resourceId: input.id,
					}),
				);
			});
		},
		async finalize(input) {
			return resolveDatabase().transaction(async (transaction) => {
				await lockLiveProgram(transaction, input.programId);
				const stored = await lockLiveVersion(
					transaction,
					input.programId,
					input.id,
				);
				assertCurrentRowVersion(stored, input.expectedRowVersion);
				if (stored.lifecycleStatus !== "draft") {
					throw new VersionDraftRequiredRepositoryError();
				}
				if (stored.expectedFileCount === null) {
					throw new Error("Draft expected file count invariant was violated.");
				}
				const [counts] = await transaction
					.select({
						associated: count(),
						uniquePaths: countDistinct(fileMetadata.path),
					})
					.from(versionFiles)
					.innerJoin(
						fileMetadata,
						eq(fileMetadata.id, versionFiles.fileMetadataId),
					)
					.where(
						and(
							eq(versionFiles.versionId, input.id),
							isNull(fileMetadata.deletedAt),
						),
					);
				const associated = Number(counts?.associated ?? 0);
				const uniquePaths = Number(counts?.uniquePaths ?? 0);
				if (associated < stored.expectedFileCount) {
					throw new DraftIncompleteRepositoryError(
						stored.expectedFileCount,
						associated,
					);
				}
				if (associated > stored.expectedFileCount) {
					throw new DraftFileCountConflictRepositoryError(
						stored.expectedFileCount,
						associated,
					);
				}
				if (uniquePaths !== associated) {
					throw new DraftPathConflictRepositoryError();
				}

				const before = withDerivedVersionFields(stored, associated, null);
				const [finalized] = await transaction
					.update(applicationVersions)
					.set({
						finalizedAt: input.now,
						lifecycleStatus: "finalized",
						rowVersion: sql`${applicationVersions.rowVersion} + 1`,
						updatedAt: input.now,
						updatedBy: input.audit.actorId,
					})
					.where(
						and(
							eq(applicationVersions.id, input.id),
							eq(applicationVersions.applicationId, input.programId),
							eq(applicationVersions.lifecycleStatus, "draft"),
							isNull(applicationVersions.deletedAt),
							eq(applicationVersions.rowVersion, input.expectedRowVersion),
						),
					)
					.returning(VERSION_SELECTION);
				if (!finalized) throw new VersionStaleWriteRepositoryError();
				const result = withDerivedVersionFields(finalized, associated, null);
				await createAuditRepository(transaction).append(
					auditInput(input.audit, {
						action: "version.finalized",
						after: versionAuditSummary(result),
						before: versionAuditSummary(before),
						resourceId: input.id,
					}),
				);
				return result;
			});
		},
		async findById(programId, id) {
			const databaseClient = resolveDatabase();
			await assertLiveProgramExists(databaseClient, programId);
			const [version] = await databaseClient
				.select(VERSION_SELECTION)
				.from(applicationVersions)
				.where(
					and(
						eq(applicationVersions.id, id),
						eq(applicationVersions.applicationId, programId),
						isNull(applicationVersions.deletedAt),
					),
				)
				.limit(1);
			if (!version) return null;
			const [associatedFileCount, latestId] = await Promise.all([
				readAssociatedFileCount(databaseClient, version.id),
				findLatestActiveVersionId(databaseClient, programId),
			]);
			return withDerivedVersionFields(version, associatedFileCount, latestId);
		},
		async list(input) {
			const databaseClient = resolveDatabase();
			await assertLiveProgramExists(databaseClient, input.programId);
			const where = and(
				eq(applicationVersions.applicationId, input.programId),
				isNull(applicationVersions.deletedAt),
			);
			const orderBy =
				input.sort === "createdAt:asc"
					? [asc(applicationVersions.createdAt), asc(applicationVersions.id)]
					: [desc(applicationVersions.createdAt), desc(applicationVersions.id)];
			const [items, totalRows, latestId] = await Promise.all([
				databaseClient
					.select(VERSION_LIST_SELECTION)
					.from(applicationVersions)
					.where(where)
					.orderBy(...orderBy)
					.limit(input.pageSize)
					.offset((input.page - 1) * input.pageSize),
				databaseClient
					.select({ value: count() })
					.from(applicationVersions)
					.where(where),
				findLatestActiveVersionId(databaseClient, input.programId),
			]);
			return {
				items: items.map((version) => ({
					...version,
					fileCount: version.associatedFileCount,
					isLatest: version.id === latestId,
				})),
				total: Number(totalRows[0]?.value ?? 0),
			};
		},
		async setActivation(input) {
			return resolveDatabase().transaction(async (transaction) => {
				await lockLiveProgram(transaction, input.programId);
				const stored = await lockLiveVersion(
					transaction,
					input.programId,
					input.id,
				);
				assertCurrentRowVersion(stored, input.expectedRowVersion);
				if (stored.lifecycleStatus !== "finalized") {
					throw new VersionFinalizedRequiredRepositoryError();
				}
				const associatedFileCount = await readAssociatedFileCount(
					transaction,
					input.id,
				);
				const beforeLatestId = await findLatestActiveVersionId(
					transaction,
					input.programId,
				);
				const before = withDerivedVersionFields(
					stored,
					associatedFileCount,
					beforeLatestId,
				);

				let updated = stored;
				if (stored.isActive !== input.isActive) {
					const [changed] = await transaction
						.update(applicationVersions)
						.set({
							isActive: input.isActive,
							rowVersion: sql`${applicationVersions.rowVersion} + 1`,
							updatedAt: input.now,
							updatedBy: input.audit.actorId,
						})
						.where(
							and(
								eq(applicationVersions.id, input.id),
								eq(applicationVersions.applicationId, input.programId),
								eq(applicationVersions.lifecycleStatus, "finalized"),
								isNull(applicationVersions.deletedAt),
								eq(applicationVersions.rowVersion, input.expectedRowVersion),
							),
						)
						.returning(VERSION_SELECTION);
					if (!changed) throw new VersionStaleWriteRepositoryError();
					updated = changed;
				}
				const latestId = await findLatestActiveVersionId(
					transaction,
					input.programId,
				);
				const result = withDerivedVersionFields(
					updated,
					associatedFileCount,
					latestId,
				);
				await createAuditRepository(transaction).append(
					auditInput(input.audit, {
						action: "version.activation.updated",
						after: versionAuditSummary(result),
						before: versionAuditSummary(before),
						resourceId: input.id,
					}),
				);
				return result;
			});
		},
		update: (input) =>
			mapVersionNumberConflict(() =>
				resolveDatabase().transaction(async (transaction) => {
					await lockLiveProgram(transaction, input.programId);
					const stored = await lockLiveVersion(
						transaction,
						input.programId,
						input.id,
					);
					assertCurrentRowVersion(stored, input.expectedRowVersion);
					const associatedFileCount = await readAssociatedFileCount(
						transaction,
						input.id,
					);
					const beforeLatestId = await findLatestActiveVersionId(
						transaction,
						input.programId,
					);
					const before = withDerivedVersionFields(
						stored,
						associatedFileCount,
						beforeLatestId,
					);

					const nextNumber = requestedVersionNumber(input);
					if (nextNumber) {
						await assertNoLiveVersionNumberDuplicate(
							transaction,
							input.programId,
							nextNumber,
							input.id,
						);
						const maximum = await findLiveFinalizedMaximum(
							transaction,
							input.programId,
						);
						assertGreaterThanLiveFinalizedMaximum(nextNumber, maximum);
					}

					const [updated] = await transaction
						.update(applicationVersions)
						.set({
							...(input.description === undefined
								? {}
								: { description: input.description }),
							...(nextNumber ?? {}),
							rowVersion: sql`${applicationVersions.rowVersion} + 1`,
							updatedAt: input.now,
							updatedBy: input.audit.actorId,
						})
						.where(
							and(
								eq(applicationVersions.id, input.id),
								eq(applicationVersions.applicationId, input.programId),
								isNull(applicationVersions.deletedAt),
								eq(applicationVersions.rowVersion, input.expectedRowVersion),
							),
						)
						.returning(VERSION_SELECTION);
					if (!updated) throw new VersionStaleWriteRepositoryError();
					const latestId = await findLatestActiveVersionId(
						transaction,
						input.programId,
					);
					const result = withDerivedVersionFields(
						updated,
						associatedFileCount,
						latestId,
					);
					await createAuditRepository(transaction).append(
						auditInput(input.audit, {
							action: "version.updated",
							after: versionAuditSummary(result),
							before: versionAuditSummary(before),
							resourceId: input.id,
						}),
					);
					return result;
				}),
			),
	};
}
