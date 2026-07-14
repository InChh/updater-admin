import { and, asc, count, desc, eq, inArray, isNull, sql } from "drizzle-orm";

import type {
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
	readonly createdAt: Date;
	readonly createdBy: string;
	readonly description: string;
	readonly fileCount: number;
	readonly id: string;
	readonly isActive: boolean;
	readonly isLatest: boolean;
	readonly programId: string;
	readonly rowVersion: bigint;
	readonly updatedAt: Date;
	readonly updatedBy: string;
	readonly versionMajor: number;
	readonly versionMinor: number;
	readonly versionNumber: string;
	readonly versionPatch: number;
}

export interface VersionDetailRecord extends VersionRecord {
	readonly fileIds: readonly string[];
}

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

export interface CreateVersionRepositoryInput
	extends VersionNumberRepositoryValue {
	readonly audit: ProgramMutationContext;
	readonly description: string;
	readonly fileIds: readonly string[];
	readonly isActive: boolean;
	readonly programId: string;
}

export interface UpdateVersionRepositoryInput {
	readonly audit: ProgramMutationContext;
	readonly description?: string;
	readonly expectedRowVersion: bigint;
	readonly fileIds?: readonly string[];
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
	create(input: CreateVersionRepositoryInput): Promise<VersionDetailRecord>;
	delete(input: DeleteVersionRepositoryInput): Promise<void>;
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
				: "Version number must be greater than every historical version.",
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

export class VersionFilesNotFoundRepositoryError extends Error {
	readonly missingFileIds: readonly string[];

	constructor(missingFileIds: readonly string[]) {
		super("One or more file metadata records were not found.");
		this.name = "VersionFilesNotFoundRepositoryError";
		this.missingFileIds = missingFileIds;
	}
}

interface StoredVersionRecord {
	readonly createdAt: Date;
	readonly createdBy: string;
	readonly description: string;
	readonly id: string;
	readonly isActive: boolean;
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
	id: applicationVersions.id,
	isActive: applicationVersions.isActive,
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
	fileCount: sql<number>`(
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

export function normalizeRelationFileIds(
	fileIds: readonly string[],
): readonly string[] {
	return [...new Set(fileIds)].sort();
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

async function findHistoricalMaximum(
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
		.where(eq(applicationVersions.applicationId, programId))
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

function assertGreaterThanHistoricalMaximum(
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

async function readRelationFileIds(
	database: Pick<Database, "select">,
	versionId: string,
): Promise<readonly string[]> {
	const rows = await database
		.select({ id: versionFiles.fileMetadataId })
		.from(versionFiles)
		.where(eq(versionFiles.versionId, versionId))
		.orderBy(asc(versionFiles.fileMetadataId));
	return rows.map(({ id }) => id);
}

async function assertLiveFileIds(
	transaction: DatabaseTransaction,
	fileIds: readonly string[],
): Promise<readonly string[]> {
	const normalized = normalizeRelationFileIds(fileIds);
	if (normalized.length === 0) return normalized;
	const rows = await transaction
		.select({ id: fileMetadata.id })
		.from(fileMetadata)
		.where(
			and(inArray(fileMetadata.id, normalized), isNull(fileMetadata.deletedAt)),
		);
	const found = new Set(rows.map(({ id }) => id));
	const missing = normalized.filter((id) => !found.has(id));
	if (missing.length > 0) {
		throw new VersionFilesNotFoundRepositoryError(missing);
	}
	return normalized;
}

async function replaceRelationFileIds(
	transaction: DatabaseTransaction,
	versionId: string,
	fileIds: readonly string[],
): Promise<void> {
	await transaction
		.delete(versionFiles)
		.where(eq(versionFiles.versionId, versionId));
	if (fileIds.length > 0) {
		await transaction
			.insert(versionFiles)
			.values(fileIds.map((fileMetadataId) => ({ fileMetadataId, versionId })));
	}
}

function withDerivedVersionFields(
	version: StoredVersionRecord,
	fileIds: readonly string[],
	latestActiveVersionId: string | null,
): VersionDetailRecord {
	return {
		...version,
		fileCount: fileIds.length,
		fileIds,
		isLatest: version.id === latestActiveVersionId,
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
		create: (input) =>
			mapVersionNumberConflict(() =>
				resolveDatabase().transaction(async (transaction) => {
					await lockLiveProgram(transaction, input.programId);
					await assertNoLiveVersionNumberDuplicate(
						transaction,
						input.programId,
						input,
					);
					const maximum = await findHistoricalMaximum(
						transaction,
						input.programId,
					);
					assertGreaterThanHistoricalMaximum(input, maximum);
					const fileIds = await assertLiveFileIds(transaction, input.fileIds);

					const [created] = await transaction
						.insert(applicationVersions)
						.values({
							applicationId: input.programId,
							createdBy: input.audit.actorId,
							description: input.description,
							isActive: input.isActive,
							updatedBy: input.audit.actorId,
							versionMajor: input.versionMajor,
							versionMinor: input.versionMinor,
							versionNumber: input.versionNumber,
							versionPatch: input.versionPatch,
						})
						.returning(VERSION_SELECTION);
					if (!created) throw new Error("Version insert returned no row.");
					if (fileIds.length > 0) {
						await transaction.insert(versionFiles).values(
							fileIds.map((fileMetadataId) => ({
								fileMetadataId,
								versionId: created.id,
							})),
						);
					}
					const latestId = await findLatestActiveVersionId(
						transaction,
						input.programId,
					);
					const result = withDerivedVersionFields(created, fileIds, latestId);
					await createAuditRepository(transaction).append(
						auditInput(input.audit, {
							action: "version.created",
							after: result,
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
				const fileIds = await readRelationFileIds(transaction, input.id);
				const beforeLatestId = await findLatestActiveVersionId(
					transaction,
					input.programId,
				);
				const before = withDerivedVersionFields(
					stored,
					fileIds,
					beforeLatestId,
				);

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
							...withDerivedVersionFields(deleted, fileIds, null),
							deletedAt: input.now,
							deletedBy: input.audit.actorId,
						},
						before,
						resourceId: input.id,
					}),
				);
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
			const fileIds = await readRelationFileIds(databaseClient, version.id);
			const latestId = await findLatestActiveVersionId(
				databaseClient,
				programId,
			);
			return withDerivedVersionFields(version, fileIds, latestId);
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
				const fileIds = await readRelationFileIds(transaction, input.id);
				const beforeLatestId = await findLatestActiveVersionId(
					transaction,
					input.programId,
				);
				const before = withDerivedVersionFields(
					stored,
					fileIds,
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
				const result = withDerivedVersionFields(updated, fileIds, latestId);
				await createAuditRepository(transaction).append(
					auditInput(input.audit, {
						action: "version.activation.updated",
						after: result,
						before,
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
					const beforeFileIds = await readRelationFileIds(
						transaction,
						input.id,
					);
					const beforeLatestId = await findLatestActiveVersionId(
						transaction,
						input.programId,
					);
					const before = withDerivedVersionFields(
						stored,
						beforeFileIds,
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
						const maximum = await findHistoricalMaximum(
							transaction,
							input.programId,
						);
						assertGreaterThanHistoricalMaximum(nextNumber, maximum);
					}
					const afterFileIds =
						input.fileIds === undefined
							? beforeFileIds
							: await assertLiveFileIds(transaction, input.fileIds);
					if (input.fileIds !== undefined) {
						await replaceRelationFileIds(transaction, input.id, afterFileIds);
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
						afterFileIds,
						latestId,
					);
					await createAuditRepository(transaction).append(
						auditInput(input.audit, {
							action: "version.updated",
							after: result,
							before,
							resourceId: input.id,
						}),
					);
					return result;
				}),
			),
	};
}
