import type { SystemSettingsPageSize } from "../../shared/api/settings";

interface ListSearchWithOptionalPageSize {
	readonly pageSize?: SystemSettingsPageSize;
}

/**
 * Resolve the canonical validated search state. Search validators preserve an
 * omitted pageSize as `undefined`, while explicit values (including sanitized
 * invalid input) carry a concrete value and remain authoritative.
 */
export function applySystemDefaultPageSize<const Search extends object>(
	search: Search & ListSearchWithOptionalPageSize,
	defaultPageSize: SystemSettingsPageSize,
): Search & { readonly pageSize: SystemSettingsPageSize } {
	return { ...search, pageSize: search.pageSize ?? defaultPageSize };
}
