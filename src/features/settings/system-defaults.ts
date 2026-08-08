import type { QueryClient } from "@tanstack/solid-query";

import type { SystemSettingsPageSize } from "../../shared/api/settings";
import { systemSettingsQueryOptions } from "./system-queries";

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

/**
 * Keep route transitions synchronous. A stale cached value is still the current
 * user-visible default; before the first settings response, use the product
 * fallback and refresh in the background instead of blocking navigation.
 */
export function resolveSystemDefaultPageSize(
	queryClient: QueryClient,
): SystemSettingsPageSize {
	const options = systemSettingsQueryOptions();
	const cached = queryClient.getQueryData(options.queryKey);
	void queryClient.prefetchQuery(options);
	return cached?.data.defaultPageSize ?? 20;
}
