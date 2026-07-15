import { queryOptions } from "@tanstack/solid-query";

import { systemSettingsQueryKeys } from "../../lib/api/query-keys";
import { getSystemSettings } from "./system-api";

export function systemSettingsQueryOptions() {
	return queryOptions({
		queryFn: ({ signal }) => getSystemSettings(signal),
		queryKey: systemSettingsQueryKeys.detail(),
		refetchOnWindowFocus: false,
		staleTime: 30_000,
	});
}
