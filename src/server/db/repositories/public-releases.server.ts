import {
	and,
	asc,
	desc,
	eq,
	gt,
	isNotNull,
	isNull,
	or,
	sql,
} from "drizzle-orm";

import {
	PUBLIC_RELEASE_DOWNLOAD_REQUEST_MAX_ITEMS,
	PUBLIC_RELEASE_FILE_PAGE_MAX_SIZE,
} from "../../../shared/api/public-releases";
import { type Database, getDatabase } from "../client.server";
import {
	applications,
	applicationVersions,
	fileMetadata,
	versionFiles,
} from "../schema";

type PublicReleasesDatabase = Pick<Database, "select">;
const SELECTED_RELEASE_ALIAS = "selected_public_release";
const publishedAtDecoder = {
	mapFromDriverValue(value: unknown): Date {
		const date = value instanceof Date ? value : new Date(String(value));
		if (Number.isNaN(date.getTime())) {
			throw new Error("Public release published time invariant was violated.");
		}
		return date;
	},
};

function selectedReleaseColumn<T>(columnName: string) {
	return sql<T>`${sql.identifier(SELECTED_RELEASE_ALIAS)}.${sql.identifier(columnName)}`;
}

export interface PublicReleaseVersionNumber {
	readonly versionMajor: number;
	readonly versionMinor: number;
	readonly versionNumber: string;
	readonly versionPatch: number;
}

export interface PublicReleaseFileRecord {
	readonly checksumAlgorithm: "sha256";
	readonly mimeType: string;
	/** Server-only storage identity. It must be consumed before DTO mapping. */
	readonly objectKey: string;
	readonly path: string;
	readonly sha256: string;
	readonly size: bigint;
}

export interface PublicReleaseRecord {
	readonly description: string;
	readonly files: readonly PublicReleaseFileRecord[];
	readonly programId: string;
	readonly programName: string;
	readonly publishedAt: Date;
	readonly versionNumber: string;
}

export interface PublicReleaseHeaderRecord {
	readonly description: string;
	readonly fileCount: number;
	readonly programName: string;
	readonly publishedAt: Date;
	readonly versionNumber: string;
}

export interface PublicReleaseFileMetadataRecord {
	readonly checksumAlgorithm: "sha256";
	readonly mimeType: string;
	readonly path: string;
	readonly sha256: string;
	readonly size: bigint;
}

export interface PublicReleaseFilePageRecord {
	readonly items: readonly PublicReleaseFileMetadataRecord[];
	readonly nextPath: string | null;
}

export type PublicReleaseFilePageLookup =
	| { readonly status: "cursorNotFound" }
	| {
			readonly page: PublicReleaseFilePageRecord;
			readonly status: "found";
	  }
	| { readonly status: "releaseNotFound" };

export interface PublicReleaseDownloadFileRecord {
	/** Server-only storage identity. It must be consumed before DTO mapping. */
	readonly objectKey: string;
	readonly path: string;
	readonly sha256: string;
}

export interface PublicReleaseFilePageRepositoryInput {
	readonly afterPath?: string;
	readonly pageSize: number;
	readonly programId: string;
	readonly version: PublicReleaseVersionNumber;
}

export interface PublicReleaseDownloadFilesRepositoryInput {
	readonly files: readonly {
		readonly path: string;
		readonly sha256: string;
	}[];
	readonly programId: string;
	readonly version: PublicReleaseVersionNumber;
}

/** Existing v1 repository surface, kept separate for compatibility. */
export interface PublicReleasesRepository {
	findActiveByVersionNumber(
		programId: string,
		version: PublicReleaseVersionNumber,
	): Promise<PublicReleaseRecord | null>;
	findLatestActive(programId: string): Promise<PublicReleaseRecord | null>;
}

export interface PublicReleasesV2Repository {
	findDownloadFiles(
		input: PublicReleaseDownloadFilesRepositoryInput,
	): Promise<readonly PublicReleaseDownloadFileRecord[]>;
	findFilePage(
		input: PublicReleaseFilePageRepositoryInput,
	): Promise<PublicReleaseFilePageLookup>;
	findHeaderByVersionNumber(
		programId: string,
		version: PublicReleaseVersionNumber,
	): Promise<PublicReleaseHeaderRecord | null>;
	findLatestHeader(
		programId: string,
	): Promise<PublicReleaseHeaderRecord | null>;
}

export type PublicReleasesRepositoryBundle = PublicReleasesRepository &
	PublicReleasesV2Repository;

export interface PublicReleaseQueryRow {
	readonly description: string;
	readonly fileChecksumAlgorithm: string | null;
	readonly fileId: string | null;
	readonly fileMimeType: string | null;
	readonly fileObjectKey: string | null;
	readonly filePath: string | null;
	readonly fileSha256: string | null;
	readonly fileSize: bigint | null;
	readonly programId: string;
	readonly programName: string;
	readonly publishedAt: Date;
	readonly versionNumber: string;
}

export interface PublicReleaseHeaderQueryRow {
	readonly description: string;
	readonly fileCount: number;
	readonly programName: string;
	readonly publishedAt: Date;
	readonly versionNumber: string;
}

export interface PublicReleaseFileMetadataQueryRow {
	readonly checksumAlgorithm: string;
	readonly mimeType: string;
	readonly path: string;
	readonly sha256: string;
	readonly size: bigint;
}

function selectedReleaseQuery(
	database: PublicReleasesDatabase,
	programId: string,
	version?: PublicReleaseVersionNumber,
) {
	const filters = [
		eq(applications.id, programId),
		isNull(applications.deletedAt),
		eq(applicationVersions.lifecycleStatus, "finalized"),
		eq(applicationVersions.isActive, true),
		isNotNull(applicationVersions.finalizedAt),
		isNull(applicationVersions.deletedAt),
	];
	if (version) {
		filters.push(
			eq(applicationVersions.versionNumber, version.versionNumber),
			eq(applicationVersions.versionMajor, version.versionMajor),
			eq(applicationVersions.versionMinor, version.versionMinor),
			eq(applicationVersions.versionPatch, version.versionPatch),
		);
	}

	return database
		.select({
			description: sql<string>`${applicationVersions.description}`.as(
				"version_description",
			),
			programId: sql<string>`${applications.id}`.as("program_id"),
			programName: sql<string>`${applications.name}`.as("program_name"),
			publishedAt: sql<Date>`${applicationVersions.finalizedAt}`
				.mapWith(publishedAtDecoder)
				.as("published_at"),
			versionId: sql<string>`${applicationVersions.id}`.as("version_id"),
			versionNumber: sql<string>`${applicationVersions.versionNumber}`.as(
				"version_number",
			),
		})
		.from(applications)
		.innerJoin(
			applicationVersions,
			eq(applicationVersions.applicationId, applications.id),
		)
		.where(and(...filters))
		.orderBy(
			desc(applicationVersions.versionMajor),
			desc(applicationVersions.versionMinor),
			desc(applicationVersions.versionPatch),
			desc(applicationVersions.id),
		)
		.limit(1)
		.as(SELECTED_RELEASE_ALIAS);
}

function selectedReleaseFields() {
	return {
		description: selectedReleaseColumn<string>("version_description"),
		programId: selectedReleaseColumn<string>("program_id"),
		programName: selectedReleaseColumn<string>("program_name"),
		publishedAt:
			selectedReleaseColumn<Date>("published_at").mapWith(publishedAtDecoder),
		versionId: selectedReleaseColumn<string>("version_id"),
		versionNumber: selectedReleaseColumn<string>("version_number"),
	};
}

export function buildPublicReleaseQuery(
	database: PublicReleasesDatabase,
	programId: string,
	version?: PublicReleaseVersionNumber,
) {
	const selectedRelease = selectedReleaseQuery(database, programId, version);
	const selected = selectedReleaseFields();
	return database
		.select({
			description: selected.description,
			fileChecksumAlgorithm: fileMetadata.checksumAlgorithm,
			fileId: fileMetadata.id,
			fileMimeType: fileMetadata.mimeType,
			fileObjectKey: fileMetadata.objectKey,
			filePath: fileMetadata.path,
			fileSha256: fileMetadata.sha256,
			fileSize: fileMetadata.size,
			programId: selected.programId,
			programName: selected.programName,
			publishedAt: selected.publishedAt,
			versionNumber: selected.versionNumber,
		})
		.from(selectedRelease)
		.leftJoin(versionFiles, eq(versionFiles.versionId, selected.versionId))
		.leftJoin(
			fileMetadata,
			and(
				eq(fileMetadata.id, versionFiles.fileMetadataId),
				isNull(fileMetadata.deletedAt),
			),
		)
		.orderBy(asc(fileMetadata.path), asc(fileMetadata.id));
}

export function buildPublicReleaseHeaderQuery(
	database: PublicReleasesDatabase,
	programId: string,
	version?: PublicReleaseVersionNumber,
) {
	const selectedRelease = selectedReleaseQuery(database, programId, version);
	const selected = selectedReleaseFields();
	return database
		.select({
			description: selected.description,
			fileCount: sql<number>`(
				select count(*)::integer
				from ${versionFiles}
				inner join ${fileMetadata}
					on ${fileMetadata.id} = ${versionFiles.fileMetadataId}
					and ${fileMetadata.deletedAt} is null
				where ${versionFiles.versionId} = ${selected.versionId}
			)`,
			programName: selected.programName,
			publishedAt: selected.publishedAt,
			versionNumber: selected.versionNumber,
		})
		.from(selectedRelease)
		.limit(1);
}

export function buildPublicReleaseEligibilityQuery(
	database: PublicReleasesDatabase,
	programId: string,
	version: PublicReleaseVersionNumber,
) {
	const selectedRelease = selectedReleaseQuery(database, programId, version);
	const selected = selectedReleaseFields();
	return database
		.select({ versionNumber: selected.versionNumber })
		.from(selectedRelease)
		.limit(1);
}

export function buildPublicReleaseFilePageQuery(
	database: PublicReleasesDatabase,
	input: PublicReleaseFilePageRepositoryInput,
) {
	if (
		!Number.isSafeInteger(input.pageSize) ||
		input.pageSize < 1 ||
		input.pageSize > PUBLIC_RELEASE_FILE_PAGE_MAX_SIZE
	) {
		throw new RangeError("Public release page size is out of range.");
	}
	const selectedRelease = selectedReleaseQuery(
		database,
		input.programId,
		input.version,
	);
	const selected = selectedReleaseFields();
	return database
		.select({
			checksumAlgorithm: fileMetadata.checksumAlgorithm,
			mimeType: fileMetadata.mimeType,
			path: fileMetadata.path,
			sha256: fileMetadata.sha256,
			size: fileMetadata.size,
		})
		.from(selectedRelease)
		.innerJoin(versionFiles, eq(versionFiles.versionId, selected.versionId))
		.innerJoin(
			fileMetadata,
			and(
				eq(fileMetadata.id, versionFiles.fileMetadataId),
				isNull(fileMetadata.deletedAt),
			),
		)
		.where(
			input.afterPath === undefined
				? undefined
				: gt(fileMetadata.path, input.afterPath),
		)
		.orderBy(asc(fileMetadata.path))
		.limit(input.pageSize + 1);
}

export function buildPublicReleaseCursorAnchorQuery(
	database: PublicReleasesDatabase,
	input: PublicReleaseFilePageRepositoryInput & { readonly afterPath: string },
) {
	const selectedRelease = selectedReleaseQuery(
		database,
		input.programId,
		input.version,
	);
	const selected = selectedReleaseFields();
	return database
		.select({ path: fileMetadata.path })
		.from(selectedRelease)
		.innerJoin(versionFiles, eq(versionFiles.versionId, selected.versionId))
		.innerJoin(
			fileMetadata,
			and(
				eq(fileMetadata.id, versionFiles.fileMetadataId),
				isNull(fileMetadata.deletedAt),
			),
		)
		.where(eq(fileMetadata.path, input.afterPath))
		.limit(1);
}

export function buildPublicReleaseDownloadFilesQuery(
	database: PublicReleasesDatabase,
	input: PublicReleaseDownloadFilesRepositoryInput,
) {
	if (
		input.files.length === 0 ||
		input.files.length > PUBLIC_RELEASE_DOWNLOAD_REQUEST_MAX_ITEMS
	) {
		throw new RangeError("Public release download request is out of range.");
	}
	const selectedRelease = selectedReleaseQuery(
		database,
		input.programId,
		input.version,
	);
	const selected = selectedReleaseFields();
	return database
		.select({
			objectKey: fileMetadata.objectKey,
			path: fileMetadata.path,
			sha256: fileMetadata.sha256,
		})
		.from(selectedRelease)
		.innerJoin(versionFiles, eq(versionFiles.versionId, selected.versionId))
		.innerJoin(
			fileMetadata,
			and(
				eq(fileMetadata.id, versionFiles.fileMetadataId),
				isNull(fileMetadata.deletedAt),
			),
		)
		.where(
			or(
				...input.files.map((file) =>
					and(
						eq(fileMetadata.path, file.path),
						eq(fileMetadata.sha256, file.sha256),
					),
				),
			),
		);
}

export function mapPublicReleaseRows(
	rows: readonly PublicReleaseQueryRow[],
): PublicReleaseRecord | null {
	const first = rows[0];
	if (!first) return null;

	const files: PublicReleaseFileRecord[] = [];
	for (const row of rows) {
		if (row.fileId === null) {
			if (
				row.fileChecksumAlgorithm !== null ||
				row.fileMimeType !== null ||
				row.fileObjectKey !== null ||
				row.filePath !== null ||
				row.fileSha256 !== null ||
				row.fileSize !== null
			) {
				throw new Error("Public release file join invariant was violated.");
			}
			continue;
		}
		if (
			row.fileChecksumAlgorithm !== "sha256" ||
			row.fileMimeType === null ||
			row.fileObjectKey === null ||
			row.filePath === null ||
			row.fileSha256 === null ||
			row.fileSize === null ||
			row.fileSize < 0n
		) {
			throw new Error("Public release file metadata invariant was violated.");
		}
		files.push({
			checksumAlgorithm: "sha256",
			mimeType: row.fileMimeType,
			objectKey: row.fileObjectKey,
			path: row.filePath,
			sha256: row.fileSha256,
			size: row.fileSize,
		});
	}

	return {
		description: first.description,
		files,
		programId: first.programId,
		programName: first.programName,
		publishedAt: first.publishedAt,
		versionNumber: first.versionNumber,
	};
}

export function mapPublicReleaseHeaderRow(
	row: PublicReleaseHeaderQueryRow | undefined,
): PublicReleaseHeaderRecord | null {
	if (!row) return null;
	if (
		!Number.isSafeInteger(row.fileCount) ||
		row.fileCount < 0 ||
		Number.isNaN(row.publishedAt.getTime())
	) {
		throw new Error("Public release header invariant was violated.");
	}
	return row;
}

export function mapPublicReleaseFilePageRows(
	rows: readonly PublicReleaseFileMetadataQueryRow[],
	pageSize: number,
): PublicReleaseFilePageRecord {
	if (
		!Number.isSafeInteger(pageSize) ||
		pageSize < 1 ||
		pageSize > PUBLIC_RELEASE_FILE_PAGE_MAX_SIZE
	) {
		throw new RangeError("Public release page size is out of range.");
	}
	const hasMore = rows.length > pageSize;
	const pageRows = hasMore ? rows.slice(0, pageSize) : rows;
	const items = pageRows.map((row): PublicReleaseFileMetadataRecord => {
		if (
			row.checksumAlgorithm !== "sha256" ||
			row.size < 0n ||
			row.path.length === 0
		) {
			throw new Error("Public release file metadata invariant was violated.");
		}
		return {
			checksumAlgorithm: "sha256",
			mimeType: row.mimeType,
			path: row.path,
			sha256: row.sha256,
			size: row.size,
		};
	});
	const last = items.at(-1);
	return {
		items,
		nextPath: hasMore && last ? last.path : null,
	};
}

async function findRelease(
	database: PublicReleasesDatabase,
	programId: string,
	version?: PublicReleaseVersionNumber,
): Promise<PublicReleaseRecord | null> {
	return mapPublicReleaseRows(
		await buildPublicReleaseQuery(database, programId, version),
	);
}

async function findHeader(
	database: PublicReleasesDatabase,
	programId: string,
	version?: PublicReleaseVersionNumber,
): Promise<PublicReleaseHeaderRecord | null> {
	const [row] = await buildPublicReleaseHeaderQuery(
		database,
		programId,
		version,
	);
	return mapPublicReleaseHeaderRow(row);
}

export function createPublicReleasesRepository(
	database?: PublicReleasesDatabase,
): PublicReleasesRepositoryBundle {
	const resolveDatabase = () => database ?? getDatabase();
	return {
		findActiveByVersionNumber: (programId, version) =>
			findRelease(resolveDatabase(), programId, version),
		findDownloadFiles: (input) =>
			buildPublicReleaseDownloadFilesQuery(resolveDatabase(), input),
		async findFilePage(input) {
			const [release] = await buildPublicReleaseEligibilityQuery(
				resolveDatabase(),
				input.programId,
				input.version,
			);
			if (!release) return { status: "releaseNotFound" };
			if (input.afterPath !== undefined) {
				const [anchor] = await buildPublicReleaseCursorAnchorQuery(
					resolveDatabase(),
					{ ...input, afterPath: input.afterPath },
				);
				if (!anchor) return { status: "cursorNotFound" };
			}
			const rows = await buildPublicReleaseFilePageQuery(
				resolveDatabase(),
				input,
			);
			return {
				page: mapPublicReleaseFilePageRows(rows, input.pageSize),
				status: "found",
			};
		},
		findHeaderByVersionNumber: (programId, version) =>
			findHeader(resolveDatabase(), programId, version),
		findLatestActive: (programId) => findRelease(resolveDatabase(), programId),
		findLatestHeader: (programId) => findHeader(resolveDatabase(), programId),
	};
}
