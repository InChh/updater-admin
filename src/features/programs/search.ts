import {
	PROGRAM_MAX_PAGE,
	PROGRAM_PAGE_SIZES,
	PROGRAM_SORTS,
	type ProgramListSearch,
	type ProgramPageSize,
	type ProgramSort,
} from "../../shared/api/programs";

export type ProgramDialog = "create" | "delete" | "edit";

type ProgramListLoaderDeps = Omit<ProgramListSearch, "pageSize"> & {
	readonly pageSize?: ProgramPageSize;
};

type ProgramDialogSearch =
	| {
			readonly dialog?: undefined;
			readonly programId?: undefined;
	  }
	| {
			readonly dialog: "create";
			readonly programId?: undefined;
	  }
	| {
			readonly dialog: "delete" | "edit";
			readonly programId: string;
	  };

export type ProgramRouteSearch = ProgramListSearch & ProgramDialogSearch;

export type ValidatedProgramRouteSearch = ProgramListLoaderDeps &
	ProgramDialogSearch;

const CANONICAL_UUID_PATTERN =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function safePositiveInteger(value: unknown): number {
	const parsed = typeof value === "number" ? value : Number(value);
	return Number.isSafeInteger(parsed) &&
		parsed >= 1 &&
		parsed <= PROGRAM_MAX_PAGE
		? parsed
		: 1;
}

function parsePageSize(value: unknown): ProgramPageSize {
	const parsed = typeof value === "number" ? value : Number(value);
	return PROGRAM_PAGE_SIZES.find((pageSize) => pageSize === parsed) ?? 20;
}

function isSort(value: unknown): value is ProgramSort {
	return PROGRAM_SORTS.some((sort) => sort === value);
}

export function isCanonicalUuid(value: unknown): value is string {
	return typeof value === "string" && CANONICAL_UUID_PATTERN.test(value);
}

export function validateProgramRouteSearch(
	raw: Record<string, unknown>,
): ValidatedProgramRouteSearch {
	const trimmedName = typeof raw.name === "string" ? raw.name.trim() : "";
	const listSearch: ProgramListLoaderDeps = {
		...(trimmedName && [...trimmedName].length <= 128
			? { name: trimmedName }
			: {}),
		page: safePositiveInteger(raw.page),
		...(Object.hasOwn(raw, "pageSize")
			? { pageSize: parsePageSize(raw.pageSize) }
			: {}),
		sort: isSort(raw.sort) ? raw.sort : "createdAt:desc",
	};

	if (raw.dialog === "create") {
		return { ...listSearch, dialog: "create" };
	}
	if (
		(raw.dialog === "edit" || raw.dialog === "delete") &&
		isCanonicalUuid(raw.programId)
	) {
		return {
			...listSearch,
			dialog: raw.dialog,
			programId: raw.programId,
		};
	}
	return listSearch;
}

export function programListLoaderDeps(
	search: ValidatedProgramRouteSearch,
): ProgramListLoaderDeps {
	return {
		...(search.name ? { name: search.name } : {}),
		page: search.page,
		...(search.pageSize === undefined ? {} : { pageSize: search.pageSize }),
		sort: search.sort,
	};
}

export function programListSearch(
	search: ProgramRouteSearch,
): ProgramListSearch {
	return {
		...programListLoaderDeps(search),
		pageSize: search.pageSize,
	};
}

export function closeProgramDialog(
	search: ProgramRouteSearch,
): ProgramRouteSearch {
	return programListSearch(search);
}

export function programSearchAfterDelete(
	search: ProgramRouteSearch,
	visibleItemCount: number,
): ProgramRouteSearch {
	const listSearch = programListSearch(search);
	return {
		...listSearch,
		page:
			listSearch.page > 1 && visibleItemCount <= 1
				? listSearch.page - 1
				: listSearch.page,
	};
}

export function openCreateProgramDialog(
	search: ProgramRouteSearch,
): ProgramRouteSearch {
	return { ...programListSearch(search), dialog: "create" };
}

export function openProgramDialog(
	search: ProgramRouteSearch,
	dialog: "delete" | "edit",
	programId: string,
): ProgramRouteSearch {
	if (!isCanonicalUuid(programId)) throw new TypeError("Invalid program ID.");
	return { ...programListSearch(search), dialog, programId };
}
