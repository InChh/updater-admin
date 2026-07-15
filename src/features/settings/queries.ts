import { queryOptions } from "@tanstack/solid-query";

import { profileQueryKeys } from "../../lib/api/query-keys";
import { getProfile } from "./api";

export function profileQueryOptions() {
	return queryOptions({
		queryFn: ({ signal }) => getProfile(signal),
		queryKey: profileQueryKeys.detail(),
		refetchOnWindowFocus: false,
		staleTime: 15_000,
	});
}
