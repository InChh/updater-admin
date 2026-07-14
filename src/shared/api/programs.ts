import type { Page, WeakEntityTag } from "./common";

export const PROGRAM_SORTS = ["createdAt:desc", "createdAt:asc"] as const;
export const PROGRAM_PAGE_SIZES = [20, 50, 100] as const;
export const PROGRAM_MAX_PAGE = 1_000_000;

export type ProgramSort = (typeof PROGRAM_SORTS)[number];
export type ProgramPageSize = (typeof PROGRAM_PAGE_SIZES)[number];

export interface ProgramListSearch {
	readonly name?: string;
	readonly page: number;
	readonly pageSize: ProgramPageSize;
	readonly sort: ProgramSort;
}

interface ProgramDtoBase {
	readonly createdAt: string;
	readonly description: null | string;
	readonly id: string;
	readonly name: string;
	readonly updatedAt: string;
}

/** List rows carry their mutation token so row actions need no detail fetch. */
export interface ProgramListItemDto extends ProgramDtoBase {
	readonly etag: WeakEntityTag;
}

/** Detail and mutation bodies pair with the HTTP ETag header in the client. */
export interface ProgramDetailDto extends ProgramDtoBase {
	readonly versionCount: number;
}

export type ProgramPage = Omit<Page<ProgramListItemDto>, "pageSize"> & {
	readonly pageSize: ProgramPageSize;
};

export interface CreateProgramInput {
	readonly description?: null | string;
	readonly name: string;
}

interface ProgramUpdateFields {
	readonly description: null | string;
	readonly name: string;
}

type RequireAtLeastOne<T, Keys extends keyof T = keyof T> = Keys extends keyof T
	? Readonly<Required<Pick<T, Keys>> & Partial<Omit<T, Keys>>>
	: never;

/** A PATCH must carry at least one mutable field. */
export type UpdateProgramInput = RequireAtLeastOne<ProgramUpdateFields>;
