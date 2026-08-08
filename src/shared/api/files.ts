import type { Page } from "./common";

export const FILE_SORTS = [
	"path:asc",
	"path:desc",
	"createdAt:desc",
	"createdAt:asc",
] as const;
export const VERSION_FILE_SORTS = ["path:asc", "path:desc"] as const;
export const FILE_PAGE_SIZES = [20, 50, 100] as const;
export const FILE_MAX_PAGE = 1_000_000;

export type FileSort = (typeof FILE_SORTS)[number];
export type VersionFileSort = (typeof VERSION_FILE_SORTS)[number];
export type FilePageSize = (typeof FILE_PAGE_SIZES)[number];

export interface FileListSearch {
	/** Case-sensitive literal substring filter over the relative path. */
	readonly path?: string;
	readonly page: number;
	readonly pageSize: FilePageSize;
	readonly sort: FileSort;
}

export interface VersionFileListSearch {
	readonly page: number;
	readonly pageSize: FilePageSize;
	readonly sort: VersionFileSort;
}

/** Read-only file metadata; object location and credentials never cross this API. */
export interface FileMetadataDto {
	readonly checksumAlgorithm: "sha256";
	readonly createdAt: string;
	readonly id: string;
	readonly mimeType: string;
	readonly path: string;
	readonly sha256: string;
	/** Non-negative byte count encoded in decimal to avoid JSON precision loss. */
	readonly size: string;
	readonly updatedAt: string;
}

export type FileDetailDto = FileMetadataDto;

export type FilePage = Omit<Page<FileMetadataDto>, "pageSize"> & {
	readonly pageSize: FilePageSize;
};
