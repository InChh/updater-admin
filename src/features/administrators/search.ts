import {
	ADMINISTRATOR_MAX_PAGE,
	ADMINISTRATOR_PAGE_SIZES,
	ADMINISTRATOR_SORTS,
	ADMINISTRATOR_STATUSES,
	type AdministratorListSearch,
	type AdministratorPageSize,
	type AdministratorSort,
	type AdministratorStatus,
} from "../../shared/api/administrators";

export type AdministratorDialog =
	| "create"
	| "disable"
	| "enable"
	| "reset"
	| "revoke";

type AdministratorListLoaderDeps = Omit<AdministratorListSearch, "pageSize"> & {
	readonly pageSize?: AdministratorPageSize;
};

type AdministratorDialogSearch =
	| {
			readonly administratorId?: undefined;
			readonly dialog?: undefined;
	  }
	| {
			readonly administratorId?: undefined;
			readonly dialog: "create";
	  }
	| {
			readonly administratorId: string;
			readonly dialog: Exclude<AdministratorDialog, "create">;
	  };

export type AdministratorRouteSearch = AdministratorListSearch &
	AdministratorDialogSearch;

export type ValidatedAdministratorRouteSearch = AdministratorListLoaderDeps &
	AdministratorDialogSearch;

const CANONICAL_UUID_PATTERN =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function safePage(value: unknown): number {
	const parsed = typeof value === "number" ? value : Number(value);
	return Number.isSafeInteger(parsed) &&
		parsed >= 1 &&
		parsed <= ADMINISTRATOR_MAX_PAGE
		? parsed
		: 1;
}

function pageSize(value: unknown): AdministratorPageSize {
	const parsed = typeof value === "number" ? value : Number(value);
	return (
		ADMINISTRATOR_PAGE_SIZES.find((candidate) => candidate === parsed) ?? 20
	);
}

function isSort(value: unknown): value is AdministratorSort {
	return ADMINISTRATOR_SORTS.some((candidate) => candidate === value);
}

function isStatus(value: unknown): value is AdministratorStatus {
	return ADMINISTRATOR_STATUSES.some((candidate) => candidate === value);
}

export function isCanonicalAdministratorId(value: unknown): value is string {
	return typeof value === "string" && CANONICAL_UUID_PATTERN.test(value);
}

export function validateAdministratorRouteSearch(
	raw: Record<string, unknown>,
): ValidatedAdministratorRouteSearch {
	const query = typeof raw.query === "string" ? raw.query.trim() : "";
	const listSearch: AdministratorListLoaderDeps = {
		page: safePage(raw.page),
		...(Object.hasOwn(raw, "pageSize")
			? { pageSize: pageSize(raw.pageSize) }
			: {}),
		...(query && [...query].length <= 320 ? { query } : {}),
		sort: isSort(raw.sort) ? raw.sort : "createdAt:desc",
		...(isStatus(raw.status) ? { status: raw.status } : {}),
	};

	if (raw.dialog === "create") return { ...listSearch, dialog: "create" };
	if (
		(raw.dialog === "disable" ||
			raw.dialog === "enable" ||
			raw.dialog === "reset" ||
			raw.dialog === "revoke") &&
		isCanonicalAdministratorId(raw.administratorId)
	) {
		return {
			...listSearch,
			administratorId: raw.administratorId,
			dialog: raw.dialog,
		};
	}
	return listSearch;
}

export function administratorListLoaderDeps(
	search: ValidatedAdministratorRouteSearch,
): AdministratorListLoaderDeps {
	return {
		page: search.page,
		...(search.pageSize === undefined ? {} : { pageSize: search.pageSize }),
		...(search.query ? { query: search.query } : {}),
		sort: search.sort,
		...(search.status ? { status: search.status } : {}),
	};
}

export function administratorListSearch(
	search: AdministratorRouteSearch,
): AdministratorListSearch {
	return {
		...administratorListLoaderDeps(search),
		pageSize: search.pageSize,
	};
}

export function closeAdministratorDialog(
	search: AdministratorRouteSearch,
): AdministratorRouteSearch {
	return administratorListSearch(search);
}

export function openCreateAdministratorDialog(
	search: AdministratorRouteSearch,
): AdministratorRouteSearch {
	return { ...administratorListSearch(search), dialog: "create" };
}

export function openAdministratorDialog(
	search: AdministratorRouteSearch,
	dialog: Exclude<AdministratorDialog, "create">,
	administratorId: string,
): AdministratorRouteSearch {
	if (!isCanonicalAdministratorId(administratorId)) {
		throw new TypeError("Invalid administrator ID.");
	}
	return {
		...administratorListSearch(search),
		administratorId,
		dialog,
	};
}
