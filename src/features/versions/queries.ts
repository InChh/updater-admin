import { queryOptions } from "@tanstack/solid-query";

import { versionQueryKeys } from "../../lib/api/query-keys";
import type { VersionListSearch } from "../../shared/api/versions";
import { getVersion, listVersions } from "./api";

export function versionListQueryOptions(
	programId: string,
	search: VersionListSearch,
) {
	return queryOptions({
		queryFn: ({ signal }) => listVersions(programId, search, signal),
		queryKey: versionQueryKeys.list(programId, search),
	});
}

export function versionDetailQueryOptions(
	programId: string,
	versionId: string,
) {
	return queryOptions({
		queryFn: ({ signal }) => getVersion(programId, versionId, signal),
		queryKey: versionQueryKeys.detail(programId, versionId),
		refetchOnWindowFocus: false,
		staleTime: 30_000,
	});
}
