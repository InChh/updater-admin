import {
	VERSION_MAX_PAGE,
	VERSION_PAGE_SIZES,
	VERSION_SORTS,
	type VersionListSearch,
	type VersionPageSize,
	type VersionSort,
} from "../../shared/api/versions";
import { isCanonicalUuid } from "../programs/search";

export type VersionDialog = "create" | "delete" | "edit";

type VersionListLoaderDeps = Omit<VersionListSearch, "pageSize"> & {
	readonly pageSize?: VersionPageSize;
};

type VersionDialogSearch =
	| {
			readonly dialog?: undefined;
			readonly versionId?: undefined;
	  }
	| {
			readonly dialog: "create";
			readonly versionId?: undefined;
	  }
	| {
			readonly dialog: "delete" | "edit";
			readonly versionId: string;
	  };

export type VersionRouteSearch = VersionListSearch & VersionDialogSearch;

export type ValidatedVersionRouteSearch = VersionListLoaderDeps &
	VersionDialogSearch;

export interface ProgramVersionsParams {
	readonly programId: string;
}

function safePositiveInteger(value: unknown): number {
	const parsed = typeof value === "number" ? value : Number(value);
	return Number.isSafeInteger(parsed) &&
		parsed >= 1 &&
		parsed <= VERSION_MAX_PAGE
		? parsed
		: 1;
}

function parsePageSize(value: unknown): VersionPageSize {
	const parsed = typeof value === "number" ? value : Number(value);
	return VERSION_PAGE_SIZES.find((pageSize) => pageSize === parsed) ?? 20;
}

function isSort(value: unknown): value is VersionSort {
	return VERSION_SORTS.some((sort) => sort === value);
}

export function parseProgramVersionsParams(
	raw: ProgramVersionsParams,
): ProgramVersionsParams | false {
	return isCanonicalUuid(raw.programId) ? raw : false;
}

export function validateVersionRouteSearch(
	raw: Record<string, unknown>,
): ValidatedVersionRouteSearch {
	const listSearch: VersionListLoaderDeps = {
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
		isCanonicalUuid(raw.versionId)
	) {
		return {
			...listSearch,
			dialog: raw.dialog,
			versionId: raw.versionId,
		};
	}
	return listSearch;
}

export function versionListLoaderDeps(
	search: ValidatedVersionRouteSearch,
): VersionListLoaderDeps {
	return {
		page: search.page,
		...(search.pageSize === undefined ? {} : { pageSize: search.pageSize }),
		sort: search.sort,
	};
}

export function versionListSearch(
	search: VersionRouteSearch,
): VersionListSearch {
	return {
		...versionListLoaderDeps(search),
		pageSize: search.pageSize,
	};
}

export function closeVersionDialog(
	search: VersionRouteSearch,
): VersionRouteSearch {
	return versionListSearch(search);
}

export function versionSearchAfterDelete(
	search: VersionRouteSearch,
	visibleItemCount: number,
): VersionRouteSearch {
	const listSearch = versionListSearch(search);
	return {
		...listSearch,
		page:
			listSearch.page > 1 && visibleItemCount <= 1
				? listSearch.page - 1
				: listSearch.page,
	};
}

export function openCreateVersionDialog(
	search: VersionRouteSearch,
): VersionRouteSearch {
	return { ...versionListSearch(search), dialog: "create" };
}

export function openVersionDialog(
	search: VersionRouteSearch,
	dialog: "delete" | "edit",
	versionId: string,
): VersionRouteSearch {
	if (!isCanonicalUuid(versionId)) throw new TypeError("Invalid version ID.");
	return { ...versionListSearch(search), dialog, versionId };
}
