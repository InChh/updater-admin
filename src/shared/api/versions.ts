import type { Page, WeakEntityTag } from "./common";

export const VERSION_SORTS = ["createdAt:desc", "createdAt:asc"] as const;
export const VERSION_PAGE_SIZES = [20, 50, 100] as const;
export const VERSION_MAX_PAGE = 1_000_000;

export type VersionSort = (typeof VERSION_SORTS)[number];
export type VersionPageSize = (typeof VERSION_PAGE_SIZES)[number];

export interface VersionListSearch {
	readonly page: number;
	readonly pageSize: VersionPageSize;
	readonly sort: VersionSort;
}

interface VersionDtoBase {
	readonly createdAt: string;
	readonly description: string;
	readonly fileCount: number;
	readonly id: string;
	readonly isActive: boolean;
	readonly isLatest: boolean;
	readonly programId: string;
	readonly updatedAt: string;
	readonly versionNumber: string;
}

/** List rows carry their mutation token for activation and row actions. */
export interface VersionListItemDto extends VersionDtoBase {
	readonly etag: WeakEntityTag;
}

/** Detail and mutation bodies pair with the HTTP ETag header in the client. */
export interface VersionDetailDto extends VersionDtoBase {
	readonly fileIds: readonly string[];
}

export type VersionPage = Omit<Page<VersionListItemDto>, "pageSize"> & {
	readonly pageSize: VersionPageSize;
};

export interface CreateVersionInput {
	readonly description?: string;
	/** Required on the wire; the runtime schema/domain enforce at least one ID. */
	readonly fileIds: readonly string[];
	readonly versionNumber: string;
}

interface VersionUpdateFields {
	readonly description: string;
	/** Omitted preserves relations; present with [] removes every relation. */
	readonly fileIds: readonly string[];
	readonly versionNumber: string;
}

type RequireAtLeastOne<T, Keys extends keyof T = keyof T> = Keys extends keyof T
	? Readonly<Required<Pick<T, Keys>> & Partial<Omit<T, Keys>>>
	: never;

/** A PATCH must carry at least one mutable field. */
export type UpdateVersionInput = RequireAtLeastOne<VersionUpdateFields>;

export interface SetVersionActivationInput {
	readonly isActive: boolean;
}
