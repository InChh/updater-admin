import { and, eq, isNull, sql } from "drizzle-orm";

import { type Database, getDatabase } from "../client.server";
import { fileMetadata } from "../schema";
import { createAuditRepository } from "./audit.server";
import type { ProgramMutationContext } from "./programs.server";

type DatabaseTransaction = Parameters<
	Parameters<Database["transaction"]>[0]
>[0];
type UploadsDatabase = Pick<Database, "transaction">;

export interface RegisterUploadMetadataInput {
	readonly mimeType: string;
	readonly objectEtag: string;
	readonly objectKey: string;
	readonly path: string;
	readonly sha256: string;
	readonly size: bigint;
}

export interface RegisteredUploadMetadata extends RegisterUploadMetadataInput {
	readonly checksumAlgorithm: "sha256";
	readonly createdAt: Date;
	readonly id: string;
	readonly rowVersion: bigint;
	readonly updatedAt: Date;
}

export interface CompleteUploadsRepositoryInput {
	readonly audit: ProgramMutationContext;
	readonly files: readonly RegisterUploadMetadataInput[];
}

export interface UploadsRepository {
	complete(
		input: CompleteUploadsRepositoryInput,
	): Promise<readonly RegisteredUploadMetadata[]>;
}

export class UploadMetadataConflictRepositoryError extends Error {
	readonly index: number;
	readonly path: string;

	constructor(index: number, path: string) {
		super("Existing file metadata does not match the completed upload.");
		this.name = "UploadMetadataConflictRepositoryError";
		this.index = index;
		this.path = path;
	}
}

interface StoredUploadMetadata
	extends Omit<RegisteredUploadMetadata, "checksumAlgorithm" | "objectEtag"> {
	readonly checksumAlgorithm: string;
	readonly objectEtag: string | null;
}

const UPLOAD_SELECTION = {
	checksumAlgorithm: fileMetadata.checksumAlgorithm,
	createdAt: fileMetadata.createdAt,
	id: fileMetadata.id,
	mimeType: fileMetadata.mimeType,
	objectEtag: fileMetadata.etag,
	objectKey: fileMetadata.objectKey,
	path: fileMetadata.path,
	rowVersion: fileMetadata.rowVersion,
	sha256: fileMetadata.sha256,
	size: fileMetadata.size,
	updatedAt: fileMetadata.updatedAt,
} as const;

function toRegisteredUploadMetadata(
	row: StoredUploadMetadata,
): RegisteredUploadMetadata {
	if (row.checksumAlgorithm !== "sha256" || row.objectEtag === null) {
		throw new Error("Completed upload metadata invariant was violated.");
	}
	return {
		...row,
		checksumAlgorithm: "sha256",
		objectEtag: row.objectEtag,
	};
}

export function uploadMetadataMatches(
	stored: Pick<
		RegisteredUploadMetadata,
		"mimeType" | "objectEtag" | "objectKey" | "path" | "sha256" | "size"
	>,
	requested: RegisterUploadMetadataInput,
): boolean {
	return (
		stored.path === requested.path &&
		stored.sha256 === requested.sha256 &&
		stored.size === requested.size &&
		stored.mimeType === requested.mimeType &&
		stored.objectKey === requested.objectKey &&
		stored.objectEtag === requested.objectEtag
	);
}

/**
 * Total order for the partial unique identity. Every completion transaction
 * acquires rows in this order so reversed concurrent batches cannot deadlock.
 */
export function compareUploadIdentity(
	left: Pick<RegisterUploadMetadataInput, "path" | "sha256" | "size">,
	right: Pick<RegisterUploadMetadataInput, "path" | "sha256" | "size">,
): number {
	if (left.path !== right.path) return left.path < right.path ? -1 : 1;
	if (left.sha256 !== right.sha256) return left.sha256 < right.sha256 ? -1 : 1;
	if (left.size === right.size) return 0;
	return left.size < right.size ? -1 : 1;
}

async function registerOne(
	transaction: DatabaseTransaction,
	input: RegisterUploadMetadataInput,
	actorId: string,
): Promise<RegisteredUploadMetadata> {
	const [inserted] = await transaction
		.insert(fileMetadata)
		.values({
			createdBy: actorId,
			etag: input.objectEtag,
			mimeType: input.mimeType,
			objectKey: input.objectKey,
			path: input.path,
			sha256: input.sha256,
			size: input.size,
			updatedBy: actorId,
		})
		.onConflictDoNothing({
			target: [fileMetadata.path, fileMetadata.sha256, fileMetadata.size],
			where: sql`deleted_at is null`,
		})
		.returning(UPLOAD_SELECTION);
	if (inserted) return toRegisteredUploadMetadata(inserted);

	const [existing] = await transaction
		.select(UPLOAD_SELECTION)
		.from(fileMetadata)
		.where(
			and(
				eq(fileMetadata.path, input.path),
				eq(fileMetadata.sha256, input.sha256),
				eq(fileMetadata.size, input.size),
				isNull(fileMetadata.deletedAt),
			),
		)
		.limit(1)
		.for("update");
	if (!existing) {
		throw new Error("Upload metadata conflict row was not visible.");
	}
	return toRegisteredUploadMetadata(existing);
}

export function createUploadsRepository(
	database?: UploadsDatabase,
): UploadsRepository {
	const resolveDatabase = () => database ?? getDatabase();

	return {
		complete: (input) =>
			resolveDatabase().transaction(async (transaction) => {
				const files = new Array<RegisteredUploadMetadata>(input.files.length);
				const ordered = input.files
					.map((requested, index) => ({ index, requested }))
					.sort(
						(left, right) =>
							compareUploadIdentity(left.requested, right.requested) ||
							left.index - right.index,
					);
				for (const { index, requested } of ordered) {
					const stored = await registerOne(
						transaction,
						requested,
						input.audit.actorId,
					);
					if (!uploadMetadataMatches(stored, requested)) {
						throw new UploadMetadataConflictRepositoryError(
							index,
							requested.path,
						);
					}
					files[index] = stored;
				}

				await createAuditRepository(transaction).append({
					action: "upload.completed",
					actorId: input.audit.actorId,
					after: {
						files: files.map(({ id, objectEtag, path, sha256, size }) => ({
							id,
							objectEtag,
							path,
							sha256,
							size: size.toString(),
						})),
					},
					before: null,
					ip: input.audit.ip,
					requestId: input.audit.requestId,
					resourceId: input.audit.requestId,
					resourceType: "upload",
					result: "success",
					userAgent: input.audit.userAgent,
				});

				return files;
			}),
	};
}
