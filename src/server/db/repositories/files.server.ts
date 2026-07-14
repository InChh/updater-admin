import { and, asc, count, desc, eq, isNull, like } from "drizzle-orm";

import type {
	FilePageSize,
	FileSort,
	VersionFileSort,
} from "../../../shared/api/files";
import { type Database, getDatabase } from "../client.server";
import {
	applications,
	applicationVersions,
	fileMetadata,
	versionFiles,
} from "../schema";
import {
	escapeLikeLiteral,
	ProgramNotFoundRepositoryError,
} from "./programs.server";
import { VersionNotFoundRepositoryError } from "./versions.server";

type FilesDatabase = Pick<Database, "select">;

export interface FileMetadataRecord {
	readonly checksumAlgorithm: "sha256";
	readonly createdAt: Date;
	readonly createdBy: string;
	readonly id: string;
	readonly mimeType: string;
	readonly objectEtag: string | null;
	readonly path: string;
	readonly rowVersion: bigint;
	readonly sha256: string;
	readonly size: bigint;
	readonly updatedAt: Date;
	readonly updatedBy: string;
}

export interface ListFilesRepositoryInput {
	readonly page: number;
	readonly pageSize: FilePageSize;
	readonly path?: string;
	readonly sort: FileSort;
}

export interface ListVersionFilesRepositoryInput {
	readonly page: number;
	readonly pageSize: FilePageSize;
	readonly programId: string;
	readonly sort: VersionFileSort;
	readonly versionId: string;
}

export interface ListFilesRepositoryResult {
	readonly items: readonly FileMetadataRecord[];
	readonly total: number;
}

export interface FilesRepository {
	findById(id: string): Promise<FileMetadataRecord | null>;
	list(input: ListFilesRepositoryInput): Promise<ListFilesRepositoryResult>;
	listForVersion(
		input: ListVersionFilesRepositoryInput,
	): Promise<ListFilesRepositoryResult>;
}

const FILE_SELECTION = {
	checksumAlgorithm: fileMetadata.checksumAlgorithm,
	createdAt: fileMetadata.createdAt,
	createdBy: fileMetadata.createdBy,
	id: fileMetadata.id,
	mimeType: fileMetadata.mimeType,
	objectEtag: fileMetadata.etag,
	path: fileMetadata.path,
	rowVersion: fileMetadata.rowVersion,
	sha256: fileMetadata.sha256,
	size: fileMetadata.size,
	updatedAt: fileMetadata.updatedAt,
	updatedBy: fileMetadata.updatedBy,
} as const;

type StoredFileMetadataRecord = Omit<
	FileMetadataRecord,
	"checksumAlgorithm"
> & {
	readonly checksumAlgorithm: string;
};

function toFileMetadataRecord(
	file: StoredFileMetadataRecord,
): FileMetadataRecord {
	if (file.checksumAlgorithm !== "sha256") {
		throw new Error("File metadata checksum algorithm invariant was violated.");
	}
	return { ...file, checksumAlgorithm: "sha256" };
}

function globalFileOrdering(sort: FileSort) {
	switch (sort) {
		case "path:asc":
			return [asc(fileMetadata.path), asc(fileMetadata.id)] as const;
		case "path:desc":
			return [desc(fileMetadata.path), desc(fileMetadata.id)] as const;
		case "createdAt:asc":
			return [asc(fileMetadata.createdAt), asc(fileMetadata.id)] as const;
		case "createdAt:desc":
			return [desc(fileMetadata.createdAt), desc(fileMetadata.id)] as const;
	}
}

function versionFileOrdering(sort: VersionFileSort) {
	return sort === "path:desc"
		? ([desc(fileMetadata.path), desc(fileMetadata.id)] as const)
		: ([asc(fileMetadata.path), asc(fileMetadata.id)] as const);
}

async function assertNestedOwnerExists(
	database: FilesDatabase,
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
	if (!version) throw new VersionNotFoundRepositoryError();
}

export function createFilesRepository(
	database?: FilesDatabase,
): FilesRepository {
	const resolveDatabase = () => database ?? getDatabase();

	return {
		async findById(id) {
			const [file] = await resolveDatabase()
				.select(FILE_SELECTION)
				.from(fileMetadata)
				.where(and(eq(fileMetadata.id, id), isNull(fileMetadata.deletedAt)))
				.limit(1);
			return file ? toFileMetadataRecord(file) : null;
		},
		async list(input) {
			const filters = [isNull(fileMetadata.deletedAt)];
			if (input.path !== undefined) {
				filters.push(
					like(fileMetadata.path, `%${escapeLikeLiteral(input.path)}%`),
				);
			}
			const where = and(...filters);
			const databaseClient = resolveDatabase();
			const [items, totalRows] = await Promise.all([
				databaseClient
					.select(FILE_SELECTION)
					.from(fileMetadata)
					.where(where)
					.orderBy(...globalFileOrdering(input.sort))
					.limit(input.pageSize)
					.offset((input.page - 1) * input.pageSize),
				databaseClient
					.select({ value: count() })
					.from(fileMetadata)
					.where(where),
			]);
			return {
				items: items.map(toFileMetadataRecord),
				total: Number(totalRows[0]?.value ?? 0),
			};
		},
		async listForVersion(input) {
			const databaseClient = resolveDatabase();
			await assertNestedOwnerExists(
				databaseClient,
				input.programId,
				input.versionId,
			);
			const where = and(
				eq(versionFiles.versionId, input.versionId),
				isNull(fileMetadata.deletedAt),
			);
			const [items, totalRows] = await Promise.all([
				databaseClient
					.select(FILE_SELECTION)
					.from(fileMetadata)
					.innerJoin(
						versionFiles,
						eq(versionFiles.fileMetadataId, fileMetadata.id),
					)
					.where(where)
					.orderBy(...versionFileOrdering(input.sort))
					.limit(input.pageSize)
					.offset((input.page - 1) * input.pageSize),
				databaseClient
					.select({ value: count() })
					.from(fileMetadata)
					.innerJoin(
						versionFiles,
						eq(versionFiles.fileMetadataId, fileMetadata.id),
					)
					.where(where),
			]);
			return {
				items: items.map(toFileMetadataRecord),
				total: Number(totalRows[0]?.value ?? 0),
			};
		},
	};
}
