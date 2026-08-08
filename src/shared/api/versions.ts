import type { Page, WeakEntityTag } from "./common";
import type { FileMetadataDto } from "./files";

export const VERSION_SORTS = ["createdAt:desc", "createdAt:asc"] as const;
export const VERSION_PAGE_SIZES = [20, 50, 100] as const;
export const VERSION_MAX_PAGE = 1_000_000;
export const VERSION_FILE_PAGE_DEFAULT_SIZE = 200;
export const VERSION_FILE_PAGE_MAX_SIZE = 500;
export const VERSION_LIFECYCLE_STATUSES = ["draft", "finalized"] as const;

export type VersionSort = (typeof VERSION_SORTS)[number];
export type VersionPageSize = (typeof VERSION_PAGE_SIZES)[number];
export type VersionLifecycleStatus =
	(typeof VERSION_LIFECYCLE_STATUSES)[number];

export interface VersionListSearch {
	readonly page: number;
	readonly pageSize: VersionPageSize;
	readonly sort: VersionSort;
}

interface VersionDtoBase {
	readonly associatedFileCount: number;
	readonly createdAt: string;
	readonly description: string;
	readonly expectedFileCount: number | null;
	readonly fileCount: number;
	readonly finalizedAt: string | null;
	readonly id: string;
	readonly isActive: boolean;
	readonly isLatest: boolean;
	readonly lifecycleStatus: VersionLifecycleStatus;
	readonly programId: string;
	readonly updatedAt: string;
	readonly versionNumber: string;
}

/** List rows carry their mutation token for activation and row actions. */
export interface VersionListItemDto extends VersionDtoBase {
	readonly etag: WeakEntityTag;
}

/** Detail and mutation bodies pair with the HTTP ETag header in the client. */
export type VersionDetailDto = VersionDtoBase;

export type DraftVersionDto = Omit<
	VersionListItemDto,
	"expectedFileCount" | "finalizedAt" | "isActive" | "lifecycleStatus"
> & {
	readonly expectedFileCount: number;
	readonly finalizedAt: null;
	readonly isActive: false;
	readonly lifecycleStatus: "draft";
};

export type VersionPage = Omit<Page<VersionListItemDto>, "pageSize"> & {
	readonly pageSize: VersionPageSize;
};

export interface CreateDraftVersionInput {
	readonly description?: string;
	readonly expectedFileCount: number;
	readonly versionNumber: string;
}

/** Temporary name compatibility while callers migrate to the draft route. */
export type CreateVersionInput = CreateDraftVersionInput;

interface VersionUpdateFields {
	readonly description: string;
	readonly versionNumber: string;
}

type RequireAtLeastOne<T, Keys extends keyof T = keyof T> = Keys extends keyof T
	? Readonly<Required<Pick<T, Keys>> & Partial<Omit<T, Keys>>>
	: never;

/** A PATCH must carry at least one mutable field. */
export type UpdateVersionInput = RequireAtLeastOne<VersionUpdateFields>;

/** Finalization carries only the draft ETag in the request header. */
export type FinalizeDraftVersionRequest = Readonly<Record<string, never>>;

export type FinalizeDraftVersionResponse = VersionDetailDto;

export interface VersionFileCursorSearch {
	readonly cursor?: string;
	readonly pageSize?: number;
}

export interface VersionFileCursorPage {
	readonly items: readonly FileMetadataDto[];
	readonly nextCursor: string | null;
	readonly pageSize: number;
	readonly versionId: string;
}

export interface SetVersionActivationInput {
	readonly isActive: boolean;
}
