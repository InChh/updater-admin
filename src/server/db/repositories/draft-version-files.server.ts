import { and, asc, count, eq, gt, inArray, isNull, or, sql } from "drizzle-orm";

import type { DraftFileResolveStatus } from "../../../shared/api/uploads";
import { type Database, getDatabase } from "../client.server";
import {
	applications,
	applicationVersions,
	fileMetadata,
	versionFiles,
} from "../schema";
import { createAuditRepository } from "./audit.server";
import type { ProgramMutationContext } from "./programs.server";
import { ProgramNotFoundRepositoryError } from "./programs.server";
import {
	compareUploadIdentity,
	type RegisterUploadMetadataInput,
	UploadMetadataConflictRepositoryError,
} from "./uploads.server";

type DatabaseTransaction = Parameters<
	Parameters<Database["transaction"]>[0]
>[0];
type DraftFilesDatabase = Pick<Database, "select" | "transaction">;

export interface DraftFileIdentity {
	readonly mimeType: string;
	readonly path: string;
	readonly sha256: string;
	readonly size: bigint;
}

export interface DraftFileRecord extends DraftFileIdentity {
	readonly checksumAlgorithm: "sha256";
	readonly createdAt: Date;
	readonly id: string;
	readonly updatedAt: Date;
}

interface InternalDraftFileRecord extends DraftFileRecord {
	readonly objectKey: string;
}

export interface ResolveDraftFilesRepositoryInput {
	readonly audit: ProgramMutationContext;
	readonly files: readonly DraftFileIdentity[];
	readonly programId: string;
	readonly versionId: string;
}

export interface AssociatedResolvedDraftFile {
	readonly canonicalMimeType?: string;
	readonly path: string;
	readonly status: DraftFileResolveStatus;
}

export interface CompleteDraftFilesRepositoryInput {
	readonly audit: ProgramMutationContext;
	readonly files: readonly RegisterUploadMetadataInput[];
	readonly programId: string;
	readonly versionId: string;
}

export interface ListDraftVersionFilesInput {
	readonly afterPath?: string;
	readonly limit: number;
	readonly programId: string;
	readonly versionId: string;
}

export interface ListDraftVersionFilesResult {
	readonly hasMore: boolean;
	readonly items: readonly DraftFileRecord[];
}

export interface DraftVersionFilesRepository {
	complete(
		input: CompleteDraftFilesRepositoryInput,
	): Promise<readonly DraftFileRecord[]>;
	listVersionFiles(
		input: ListDraftVersionFilesInput,
	): Promise<ListDraftVersionFilesResult>;
	resolve(
		input: ResolveDraftFilesRepositoryInput,
	): Promise<readonly AssociatedResolvedDraftFile[]>;
}

export class DraftVersionNotFoundRepositoryError extends Error {
	constructor() {
		super("Draft version was not found.");
		this.name = "DraftVersionNotFoundRepositoryError";
	}
}

export class DraftVersionFinalizedRepositoryError extends Error {
	constructor() {
		super("Finalized version membership is immutable.");
		this.name = "DraftVersionFinalizedRepositoryError";
	}
}

export class DraftVersionPathConflictRepositoryError extends Error {
	readonly index: number;
	readonly path: string;

	constructor(index: number, path: string) {
		super("The draft already contains different content at this path.");
		this.name = "DraftVersionPathConflictRepositoryError";
		this.index = index;
		this.path = path;
	}
}

interface StoredFileRow
	extends Omit<InternalDraftFileRecord, "checksumAlgorithm"> {
	readonly checksumAlgorithm: string;
}

const INTERNAL_FILE_SELECTION = {
	checksumAlgorithm: fileMetadata.checksumAlgorithm,
	createdAt: fileMetadata.createdAt,
	id: fileMetadata.id,
	mimeType: fileMetadata.mimeType,
	objectKey: fileMetadata.objectKey,
	path: fileMetadata.path,
	sha256: fileMetadata.sha256,
	size: fileMetadata.size,
	updatedAt: fileMetadata.updatedAt,
} as const;

const PUBLIC_FILE_SELECTION = {
	checksumAlgorithm: fileMetadata.checksumAlgorithm,
	createdAt: fileMetadata.createdAt,
	id: fileMetadata.id,
	mimeType: fileMetadata.mimeType,
	path: fileMetadata.path,
	sha256: fileMetadata.sha256,
	size: fileMetadata.size,
	updatedAt: fileMetadata.updatedAt,
} as const;

function toInternalFile(row: StoredFileRow): InternalDraftFileRecord {
	if (row.checksumAlgorithm !== "sha256") {
		throw new Error("Draft file checksum algorithm invariant was violated.");
	}
	return { ...row, checksumAlgorithm: "sha256" };
}

function toPublicFile(row: Omit<StoredFileRow, "objectKey">): DraftFileRecord {
	if (row.checksumAlgorithm !== "sha256") {
		throw new Error("Draft file checksum algorithm invariant was violated.");
	}
	return { ...row, checksumAlgorithm: "sha256" };
}

function identityKey(
	value: Pick<DraftFileIdentity, "path" | "sha256" | "size">,
): string {
	return `${value.path}\0${value.sha256}\0${value.size.toString()}`;
}

function sameIdentity(
	left: Pick<DraftFileIdentity, "path" | "sha256" | "size">,
	right: Pick<DraftFileIdentity, "path" | "sha256" | "size">,
): boolean {
	return (
		left.path === right.path &&
		left.sha256 === right.sha256 &&
		left.size === right.size
	);
}

function completedMetadataMatches(
	stored: InternalDraftFileRecord,
	requested: RegisterUploadMetadataInput,
): boolean {
	return (
		stored.path === requested.path &&
		stored.sha256 === requested.sha256 &&
		stored.size === requested.size &&
		stored.objectKey === requested.objectKey
	);
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

async function lockDraftVersion(
	transaction: DatabaseTransaction,
	programId: string,
	versionId: string,
): Promise<void> {
	const [version] = await transaction
		.select({ lifecycleStatus: applicationVersions.lifecycleStatus })
		.from(applicationVersions)
		.where(
			and(
				eq(applicationVersions.id, versionId),
				eq(applicationVersions.applicationId, programId),
				isNull(applicationVersions.deletedAt),
			),
		)
		.limit(1)
		.for("update");
	if (!version) throw new DraftVersionNotFoundRepositoryError();
	if (version.lifecycleStatus !== "draft") {
		throw new DraftVersionFinalizedRepositoryError();
	}
}

async function assertVersionOwnerExists(
	database: Pick<Database, "select">,
	programId: string,
	versionId: string,
): Promise<void> {
	const [program] = await database
		.select({ id: applications.id })
		.from(applications)
		.where(and(eq(applications.id, programId), isNull(applications.deletedAt)))
		.limit(1);
	if (!program) throw new ProgramNotFoundRepositoryError();
	const [version] = await database
		.select({ id: applicationVersions.id })
		.from(applicationVersions)
		.where(
			and(
				eq(applicationVersions.id, versionId),
				eq(applicationVersions.applicationId, programId),
				isNull(applicationVersions.deletedAt),
			),
		)
		.limit(1);
	if (!version) throw new DraftVersionNotFoundRepositoryError();
}

async function readAssociatedForPaths(
	database: Pick<Database, "select">,
	versionId: string,
	paths: readonly string[],
): Promise<readonly InternalDraftFileRecord[]> {
	if (paths.length === 0) return [];
	const rows = await database
		.select(INTERNAL_FILE_SELECTION)
		.from(versionFiles)
		.innerJoin(fileMetadata, eq(fileMetadata.id, versionFiles.fileMetadataId))
		.where(
			and(
				eq(versionFiles.versionId, versionId),
				inArray(fileMetadata.path, paths),
				isNull(fileMetadata.deletedAt),
			),
		);
	return rows.map(toInternalFile);
}

async function readAssociatedCount(
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

async function readReusableCandidates(
	database: Pick<Database, "select">,
	files: readonly DraftFileIdentity[],
): Promise<readonly InternalDraftFileRecord[]> {
	if (files.length === 0) return [];
	const rows = await database
		.select(INTERNAL_FILE_SELECTION)
		.from(fileMetadata)
		.where(
			and(
				isNull(fileMetadata.deletedAt),
				or(
					...files.map((file) =>
						and(
							eq(fileMetadata.path, file.path),
							eq(fileMetadata.sha256, file.sha256),
							eq(fileMetadata.size, file.size),
						),
					),
				),
			),
		)
		.for("share");
	return rows.map(toInternalFile);
}

async function readMetadataForIdentities(
	transaction: DatabaseTransaction,
	files: readonly RegisterUploadMetadataInput[],
): Promise<readonly InternalDraftFileRecord[]> {
	if (files.length === 0) return [];
	const rows = await transaction
		.select(INTERNAL_FILE_SELECTION)
		.from(fileMetadata)
		.where(
			and(
				isNull(fileMetadata.deletedAt),
				or(
					...files.map((file) =>
						and(
							eq(fileMetadata.path, file.path),
							eq(fileMetadata.sha256, file.sha256),
							eq(fileMetadata.size, file.size),
						),
					),
				),
			),
		)
		.orderBy(
			asc(fileMetadata.path),
			asc(fileMetadata.sha256),
			asc(fileMetadata.size),
		)
		.for("update");
	return rows.map(toInternalFile);
}

async function registerMany(
	transaction: DatabaseTransaction,
	inputs: readonly RegisterUploadMetadataInput[],
	actorId: string,
): Promise<ReadonlyMap<string, InternalDraftFileRecord>> {
	if (inputs.length === 0) return new Map();

	// A completion request previously issued one metadata INSERT and one
	// version-file INSERT per file while holding the draft lock. On a remote Neon
	// connection that amplified each 25-file batch into roughly 50 serialized
	// round trips. Insert the normal path in two set-based statements instead.
	await transaction
		.insert(fileMetadata)
		.values(
			inputs.map((input) => ({
				createdBy: actorId,
				mimeType: input.mimeType,
				objectKey: input.objectKey,
				path: input.path,
				sha256: input.sha256,
				size: input.size,
				updatedBy: actorId,
			})),
		)
		.onConflictDoNothing({
			target: [fileMetadata.path, fileMetadata.sha256, fileMetadata.size],
			where: sql`deleted_at is null`,
		});

	const storedRows = await readMetadataForIdentities(transaction, inputs);
	const storedByIdentity = new Map(
		storedRows.map((stored) => [identityKey(stored), stored]),
	);
	return storedByIdentity;
}

function auditInput(
	context: ProgramMutationContext,
	input: {
		readonly action: string;
		readonly after: unknown;
		readonly resourceId: string;
	},
) {
	return {
		action: input.action,
		actorId: context.actorId,
		after: input.after,
		before: null,
		ip: context.ip,
		requestId: context.requestId,
		resourceId: input.resourceId,
		resourceType: "version_files",
		result: "success" as const,
		userAgent: context.userAgent,
	};
}

export function createDraftVersionFilesRepository(
	database?: DraftFilesDatabase,
): DraftVersionFilesRepository {
	const resolveDatabase = () => database ?? getDatabase();

	return {
		async resolve(input) {
			return resolveDatabase().transaction(async (transaction) => {
				await lockLiveProgram(transaction, input.programId);
				await lockDraftVersion(transaction, input.programId, input.versionId);
				const existingRows = await readAssociatedForPaths(
					transaction,
					input.versionId,
					input.files.map(({ path }) => path),
				);
				const existingByPath = new Map(
					existingRows.map((file) => [file.path, file]),
				);
				const unresolved = input.files.filter(
					(file) => !existingByPath.has(file.path),
				);
				const candidates = await readReusableCandidates(
					transaction,
					unresolved,
				);
				const candidateByIdentity = new Map(
					candidates.map((file) => [identityKey(file), file]),
				);
				const relationsToInsert: Array<{
					fileMetadataId: string;
					versionId: string;
				}> = [];
				const results: AssociatedResolvedDraftFile[] = [];
				for (const [index, file] of input.files.entries()) {
					const existing = existingByPath.get(file.path);
					if (existing) {
						if (!sameIdentity(existing, file)) {
							throw new DraftVersionPathConflictRepositoryError(
								index,
								file.path,
							);
						}
						results.push({
							canonicalMimeType: existing.mimeType,
							path: file.path,
							status: "alreadyAssociated",
						});
						continue;
					}
					const candidate = candidateByIdentity.get(identityKey(file));
					if (candidate && sameIdentity(candidate, file)) {
						relationsToInsert.push({
							fileMetadataId: candidate.id,
							versionId: input.versionId,
						});
						existingByPath.set(file.path, candidate);
						results.push({
							canonicalMimeType: candidate.mimeType,
							path: file.path,
							status: "reused",
						});
						continue;
					}
					results.push({ path: file.path, status: "uploadRequired" });
				}
				if (relationsToInsert.length > 0) {
					await transaction
						.insert(versionFiles)
						.values(relationsToInsert)
						.onConflictDoNothing();
				}
				const newlyAssociatedCount = relationsToInsert.length;
				const totalAssociatedCount = await readAssociatedCount(
					transaction,
					input.versionId,
				);
				await createAuditRepository(transaction).append(
					auditInput(input.audit, {
						action: "version.files.resolved",
						after: {
							alreadyAssociatedCount: results.filter(
								({ status }) => status === "alreadyAssociated",
							).length,
							newlyAssociatedCount,
							requestedCount: input.files.length,
							reusedCount: results.filter(({ status }) => status === "reused")
								.length,
							totalAssociatedCount,
							uploadRequiredCount: results.filter(
								({ status }) => status === "uploadRequired",
							).length,
						},
						resourceId: input.versionId,
					}),
				);
				return results;
			});
		},
		async complete(input) {
			return resolveDatabase().transaction(async (transaction) => {
				await lockLiveProgram(transaction, input.programId);
				await lockDraftVersion(transaction, input.programId, input.versionId);
				const existingRows = await readAssociatedForPaths(
					transaction,
					input.versionId,
					input.files.map(({ path }) => path),
				);
				const existingByPath = new Map(
					existingRows.map((file) => [file.path, file]),
				);
				const completed = new Array<DraftFileRecord>(input.files.length);
				const ordered = input.files
					.map((requested, index) => ({ index, requested }))
					.sort(
						(left, right) =>
							compareUploadIdentity(left.requested, right.requested) ||
							left.index - right.index,
					);
				const missing: Array<{
					index: number;
					requested: RegisterUploadMetadataInput;
				}> = [];
				for (const { index, requested } of ordered) {
					const associated = existingByPath.get(requested.path);
					if (associated) {
						if (!sameIdentity(associated, requested)) {
							throw new DraftVersionPathConflictRepositoryError(
								index,
								requested.path,
							);
						}
						if (!completedMetadataMatches(associated, requested)) {
							throw new UploadMetadataConflictRepositoryError(
								index,
								requested.path,
							);
						}
						completed[index] = associated;
						continue;
					}
					missing.push({ index, requested });
				}

				const storedByIdentity = await registerMany(
					transaction,
					missing.map(({ requested }) => requested),
					input.audit.actorId,
				);
				const relationsToInsert: Array<{
					fileMetadataId: string;
					versionId: string;
				}> = [];
				for (const { index, requested } of missing) {
					const stored = storedByIdentity.get(identityKey(requested));
					if (!stored) {
						throw new Error("Upload metadata conflict row was not visible.");
					}
					if (!completedMetadataMatches(stored, requested)) {
						throw new UploadMetadataConflictRepositoryError(
							index,
							requested.path,
						);
					}
					relationsToInsert.push({
						fileMetadataId: stored.id,
						versionId: input.versionId,
					});
					existingByPath.set(requested.path, stored);
					completed[index] = stored;
				}
				if (relationsToInsert.length > 0) {
					await transaction
						.insert(versionFiles)
						.values(relationsToInsert)
						.onConflictDoNothing();
				}
				const newlyAssociatedCount = relationsToInsert.length;
				const totalAssociatedCount = await readAssociatedCount(
					transaction,
					input.versionId,
				);
				await createAuditRepository(transaction).append(
					auditInput(input.audit, {
						action: "version.files.completed",
						after: {
							alreadyAssociatedCount: input.files.length - newlyAssociatedCount,
							newlyAssociatedCount,
							requestedCount: input.files.length,
							totalAssociatedCount,
						},
						resourceId: input.versionId,
					}),
				);
				return completed;
			});
		},
		async listVersionFiles(input) {
			const databaseClient = resolveDatabase();
			await assertVersionOwnerExists(
				databaseClient,
				input.programId,
				input.versionId,
			);
			const rows = await databaseClient
				.select(PUBLIC_FILE_SELECTION)
				.from(versionFiles)
				.innerJoin(
					fileMetadata,
					eq(fileMetadata.id, versionFiles.fileMetadataId),
				)
				.where(
					and(
						eq(versionFiles.versionId, input.versionId),
						isNull(fileMetadata.deletedAt),
						...(input.afterPath === undefined
							? []
							: [gt(fileMetadata.path, input.afterPath)]),
					),
				)
				.orderBy(asc(fileMetadata.path))
				.limit(input.limit + 1);
			return {
				hasMore: rows.length > input.limit,
				items: rows.slice(0, input.limit).map(toPublicFile),
			};
		},
	};
}
