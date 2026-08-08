/** Signed download links are deliberately short-lived and manifests are not cached. */
export const PUBLIC_RELEASE_DOWNLOAD_URL_TTL_SECONDS = 300;
export const PUBLIC_RELEASE_FILE_PAGE_DEFAULT_SIZE = 200;
export const PUBLIC_RELEASE_FILE_PAGE_MAX_SIZE = 500;
export const PUBLIC_RELEASE_DOWNLOAD_REQUEST_MAX_ITEMS = 100;

export interface PublicReleaseFileDto {
	readonly checksumAlgorithm: "sha256";
	readonly downloadUrl: string;
	readonly mimeType: string;
	readonly path: string;
	readonly sha256: string;
	/** Non-negative byte count encoded in decimal to avoid JSON precision loss. */
	readonly size: string;
}

/** Anonymous, read-only release contract. No database or storage identity is exposed. */
export interface PublicReleaseManifestDto {
	readonly description: string;
	readonly downloadExpiresAt: string;
	readonly files: readonly PublicReleaseFileDto[];
	readonly programId: string;
	readonly programName: string;
	readonly publishedAt: string;
	readonly versionNumber: string;
}

/** Public v2 release metadata. File metadata is traversed separately. */
export interface PublicReleaseHeaderDto {
	readonly description: string;
	readonly fileCount: number;
	readonly programName: string;
	readonly publishedAt: string;
	readonly versionNumber: string;
}

/** Public v2 checksum metadata without storage or database identities. */
export interface PublicReleaseFileMetadataDto {
	readonly checksumAlgorithm: "sha256";
	readonly mimeType: string;
	readonly path: string;
	readonly sha256: string;
	/** Non-negative byte count encoded in decimal to avoid JSON precision loss. */
	readonly size: string;
}

export interface PublicReleaseFilePageSearch {
	readonly cursor?: string;
	readonly pageSize?: number;
}

export interface PublicReleaseFilePageDto {
	readonly items: readonly PublicReleaseFileMetadataDto[];
	readonly nextCursor: string | null;
	readonly pageSize: number;
	readonly versionNumber: string;
}

export interface PublicReleaseDownloadFileInput {
	readonly path: string;
	readonly sha256: string;
}

export interface PublicReleaseDownloadUrlsRequest {
	readonly files: readonly PublicReleaseDownloadFileInput[];
}

export interface PublicReleaseDownloadUrlDto
	extends PublicReleaseDownloadFileInput {
	readonly downloadUrl: string;
}

export interface PublicReleaseDownloadUrlsResponse {
	readonly downloadExpiresAt: string;
	readonly files: readonly PublicReleaseDownloadUrlDto[];
}
