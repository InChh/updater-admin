import type { QueryClient } from "@tanstack/solid-query";

import { systemSettingsQueryKeys } from "../../lib/api/query-keys";
import type { EntityResult } from "../../shared/api/common";
import type { SystemSettingsDto } from "../../shared/api/settings";

export function storeSystemSettings(
	queryClient: QueryClient,
	settings: EntityResult<SystemSettingsDto>,
): void {
	queryClient.setQueryData(systemSettingsQueryKeys.detail(), settings);
}

/**
 * Keep the mutation response as the immediate cache owner while marking only
 * this singleton stale for the next normal refresh.
 */
export function markSystemSettingsStale(queryClient: QueryClient) {
	return queryClient.invalidateQueries({
		exact: true,
		queryKey: systemSettingsQueryKeys.detail(),
		refetchType: "none",
	});
}

/** Reload the exact singleton after an optimistic-concurrency conflict. */
export function refreshStaleSystemSettings(queryClient: QueryClient) {
	return queryClient.invalidateQueries({
		exact: true,
		queryKey: systemSettingsQueryKeys.detail(),
	});
}
