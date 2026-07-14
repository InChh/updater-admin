import {
	PROGRAM_MAX_PAGE,
	PROGRAM_PAGE_SIZES,
	PROGRAM_SORTS,
	type ProgramListSearch,
	type ProgramPageSize,
	type ProgramSort,
} from "../../shared/api/programs";

export interface NormalizedProgramListSearch {
	readonly name: null | string;
	readonly page: number;
	readonly pageSize: ProgramPageSize;
	readonly sort: ProgramSort;
}

function isProgramPageSize(value: unknown): value is ProgramPageSize {
	return PROGRAM_PAGE_SIZES.some((pageSize) => pageSize === value);
}

function isProgramSort(value: unknown): value is ProgramSort {
	return PROGRAM_SORTS.some((sort) => sort === value);
}

export function normalizeProgramListSearch(
	search: ProgramListSearch,
): NormalizedProgramListSearch {
	const trimmedName = typeof search.name === "string" ? search.name.trim() : "";
	return {
		name: trimmedName || null,
		page:
			Number.isSafeInteger(search.page) &&
			search.page >= 1 &&
			search.page <= PROGRAM_MAX_PAGE
				? search.page
				: 1,
		pageSize: isProgramPageSize(search.pageSize) ? search.pageSize : 20,
		sort: isProgramSort(search.sort) ? search.sort : "createdAt:desc",
	};
}

const allProgramsKey = ["programs"] as const;

export const programQueryKeys = {
	all: allProgramsKey,
	detail: (programId: string) =>
		[...allProgramsKey, "detail", programId] as const,
	details: () => [...allProgramsKey, "detail"] as const,
	list: (search: ProgramListSearch) =>
		[...allProgramsKey, "list", normalizeProgramListSearch(search)] as const,
	lists: () => [...allProgramsKey, "list"] as const,
} as const;

export const queryKeys = {
	programs: programQueryKeys,
} as const;
